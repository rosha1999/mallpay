import { SignJWT } from "jose";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: "",
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminUser: { findFirst: mocks.findFirst, findUnique: mocks.findUnique },
  },
}));

import { clearSession, createSession, currentAdmin } from "./auth";

const originalSecret = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "auth-test-secret-".repeat(4);
  mocks.token = "";
  mocks.findFirst.mockReset();
  mocks.findUnique.mockReset();
  mocks.findFirst.mockResolvedValue({
    id: "admin-1",
    name: "Admin",
    email: "admin@example.com",
    sessionVersion: 0,
  });
  mocks.findUnique.mockResolvedValue({ sessionVersion: 0 });
  mocks.cookies.mockImplementation(async () => ({
    get: () => (mocks.token ? { value: mocks.token } : undefined),
    set: (_name: string, value: string) => {
      mocks.token = value;
    },
    delete: () => {
      mocks.token = "";
    },
  }));
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

describe("admin session authentication", () => {
  it("rejects missing and tampered cookies without querying admins", async () => {
    expect(await currentAdmin()).toBeNull();
    mocks.token = "not-a-jwt";
    expect(await currentAdmin()).toBeNull();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("accepts a valid session only for an active admin", async () => {
    await createSession("admin-1");
    await expect(currentAdmin()).resolves.toMatchObject({ id: "admin-1" });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "admin-1", active: true },
      select: { id: true, name: true, email: true, sessionVersion: true },
    });

    mocks.findFirst.mockResolvedValue(null);
    await expect(currentAdmin()).resolves.toBeNull();
  });

  it("rejects sessions issued before a credential change", async () => {
    // Session minted while version was 0...
    await createSession("admin-1");
    // ...then the admin resets the password, bumping the version.
    mocks.findFirst.mockResolvedValue({
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      sessionVersion: 1,
    });
    await expect(currentAdmin()).resolves.toBeNull();
  });

  it("rejects legacy sessions without a version claim", async () => {
    mocks.token = await new SignJWT({ sub: "admin-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    await expect(currentAdmin()).resolves.toBeNull();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("rejects expired sessions and clears the cookie", async () => {
    mocks.token = await new SignJWT({ sub: "admin-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 20)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    await expect(currentAdmin()).resolves.toBeNull();
    await clearSession();
    expect(mocks.token).toBe("");
  });
});
