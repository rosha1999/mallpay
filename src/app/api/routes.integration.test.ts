import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.TEST_DATABASE_URL;
  return {
    prisma: new PrismaClient(
      url ? { datasources: { db: { url } } } : undefined,
    ),
  };
});
vi.mock("@/lib/auth", () => ({ currentAdmin: vi.fn() }));

import { currentAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST as createRequest } from "@/app/api/requests/route";
import { POST as recordPayment } from "@/app/api/payments/route";
import { POST as createPublicRequest } from "@/app/api/public/[token]/requests/route";
import { GET as getPublicRequestPage } from "@/app/api/public/[token]/requests/route";
import { PATCH as updateCompany } from "@/app/api/companies/[id]/route";
import { POST as issueCompanyToken } from "@/app/api/companies/[id]/token/route";
import { POST as issueAllCompaniesToken } from "@/app/api/company-links/route";
import { PATCH as updateMall } from "@/app/api/malls/[id]/route";
import {
  GET as getInbox,
  PATCH as updateInbox,
} from "@/app/api/notifications/route";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const suffix = randomUUID();
const origin = "https://mallpay.test";
const session = prisma as import("@prisma/client").PrismaClient;
let admin: { id: string; name: string; email: string };
let mall: { id: string };
let company: { id: string };
let otherMall: { id: string };
let otherCompany: { id: string };
let allCompaniesTokenId: string | undefined;
let originalAppUrl: string | undefined;
const rateLimitKeys: string[] = [];

function jsonRequest(
  path: string,
  body: unknown,
  requestOrigin = origin,
  method = "POST",
) {
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: {
      origin: requestOrigin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

integration("admin API route integration", () => {
  beforeAll(async () => {
    originalAppUrl = process.env.APP_URL;
    process.env.APP_URL = origin;
    admin = await session.adminUser.create({
      data: {
        name: "MallPay API integration test",
        email: `api-test-${suffix}@example.invalid`,
        passwordHash: "not-used",
      },
      select: { id: true, name: true, email: true },
    });
    mall = await session.mall.create({ data: { name: `API mall ${suffix}` } });
    company = await session.company.create({
      data: { name: `API company ${suffix}`, mallId: mall.id },
    });
    otherMall = await session.mall.create({
      data: { name: `API second mall ${suffix}` },
    });
    otherCompany = await session.company.create({
      data: { name: `API second company ${suffix}`, mallId: otherMall.id },
    });
  });

  beforeEach(() => {
    vi.mocked(currentAdmin).mockResolvedValue(admin as never);
  });

  afterAll(async () => {
    const companyIds = [company?.id, otherCompany?.id].filter(
      (id): id is string => Boolean(id),
    );
    if (allCompaniesTokenId)
      await session.companyToken.deleteMany({
        where: { id: allCompaniesTokenId },
      });
    if (companyIds.length) {
      const requests = await session.paymentRequest.findMany({
        where: { companyId: { in: companyIds } },
        select: { id: true },
      });
      const requestIds = requests.map((request) => request.id);
      if (requestIds.length) {
        await session.notification.deleteMany({
          where: { requestId: { in: requestIds } },
        });
        await session.auditLog.deleteMany({
          where: { entityId: { in: requestIds } },
        });
      }
      await session.payment.deleteMany({
        where: { companyId: { in: companyIds } },
      });
      await session.appointment.deleteMany({
        where: { companyId: { in: companyIds } },
      });
      await session.paymentRequest.deleteMany({
        where: { companyId: { in: companyIds } },
      });
      await session.companyToken.deleteMany({
        where: { companyId: { in: companyIds } },
      });
      await session.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    if (otherMall) await session.mall.delete({ where: { id: otherMall.id } });
    if (mall) await session.mall.delete({ where: { id: mall.id } });
    if (admin) {
      await session.auditLog.deleteMany({ where: { adminId: admin.id } });
      await session.adminUser.delete({ where: { id: admin.id } });
    }
    if (databaseUrl) {
      await session.rateLimitBucket.deleteMany({
        where: { key: { in: rateLimitKeys } },
      });
    }
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    await session.$disconnect();
  });

  it("enforces admin and same-origin guards before reading or writing bodies", async () => {
    vi.mocked(currentAdmin).mockResolvedValue(null);
    const unauthenticated = await createRequest(
      jsonRequest("/api/requests", {}),
    );
    expect(unauthenticated.status).toBe(401);

    vi.mocked(currentAdmin).mockResolvedValue(admin as never);
    const crossOrigin = await createRequest(
      jsonRequest("/api/requests", {}, "https://attacker.test"),
    );
    expect(crossOrigin.status).toBe(403);

    const unsupported = await createRequest(
      new NextRequest(`${origin}/api/requests`, {
        method: "POST",
        headers: { origin, "content-type": "text/plain" },
        body: "{}",
      }),
    );
    expect(unsupported.status).toBe(415);
  });

  it("creates admin requests idempotently and rejects key reuse with different data", async () => {
    const idempotencyKey = `request-${suffix}`;
    const body = {
      companyId: company.id,
      mallId: mall.id,
      amount: "100.00",
      idempotencyKey,
    };
    const first = await createRequest(jsonRequest("/api/requests", body));
    expect(first.status).toBe(201);
    const created = await first.json();

    const replay = await createRequest(jsonRequest("/api/requests", body));
    expect(replay.status).toBe(200);
    expect((await replay.json()).id).toBe(created.id);

    const mismatch = await createRequest(
      jsonRequest("/api/requests", { ...body, amount: "101.00" }),
    );
    expect(mismatch.status).toBe(409);
    expect(
      await session.paymentRequest.count({ where: { idempotencyKey } }),
    ).toBe(1);
  });

  it("rejects overspending across concurrent payment requests", async () => {
    const request = await session.paymentRequest.create({
      data: {
        companyId: company.id,
        mallId: mall.id,
        amount: "100.00",
        status: "APPROVED",
      },
    });
    const submit = (key: string) =>
      recordPayment(
        jsonRequest("/api/payments", {
          requestId: request.id,
          idempotencyKey: key,
          amount: "60.00",
          method: "CASH",
        }),
      );
    const responses = await Promise.all([
      submit(`pay-a-${suffix}`),
      submit(`pay-b-${suffix}`),
    ]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(
      1,
    );
    expect(responses.filter((response) => response.status === 409)).toHaveLength(
      1,
    );
    const payments = await session.payment.findMany({
      where: { requestId: request.id },
    });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(60);
  });

  it("accepts a public request once and replays it with the same key", async () => {
    const token = randomUUID().replaceAll("-", "");
    const tokenRow = await session.companyToken.create({
      data: {
        companyId: company.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
      },
    });
    rateLimitKeys.push(`public-link:${tokenRow.id}`);
    const body = {
      representativeName: "Test Representative",
      amount: "50.00",
      phone: "+9647701234567",
      idempotencyKey: `public-${suffix}`,
    };
    const call = (requestOrigin = origin) =>
      createPublicRequest(
        jsonRequest(`/api/public/${token}/requests`, body, requestOrigin),
        { params: Promise.resolve({ token }) },
      );

    expect((await call("https://attacker.test")).status).toBe(403);
    const first = await call();
    expect(first.status).toBe(201);
    const firstData = await first.json();
    const replay = await call();
    expect(replay.status).toBe(200);
    expect((await replay.json()).reference).toBe(firstData.reference);
    expect(
      await session.paymentRequest.count({
        where: { idempotencyKey: body.idempotencyKey },
      }),
    ).toBe(1);
    const mismatchedCompany = await createPublicRequest(
      jsonRequest(`/api/public/${token}/requests`, {
        ...body,
        companyId: otherCompany.id,
        idempotencyKey: `public-mismatch-${suffix}`,
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(mismatchedCompany.status).toBe(400);
    const created = await session.paymentRequest.findUniqueOrThrow({
      where: { idempotencyKey: body.idempotencyKey },
    });
    const queuedEmail = await session.notification.findFirst({
      where: { requestId: created.id, channel: "EMAIL" },
    });
    expect(queuedEmail).toMatchObject({
      recipient: admin.email,
      deliveryStatus: "QUEUED",
    });
    const inbox = await getInbox(
      new NextRequest(`${origin}/api/notifications?limit=100`),
    );
    const inboxData = await inbox.json();
    const inboxItem = inboxData.rows.find(
      (row: { requestId: string | null }) => row.requestId === created.id,
    );
    expect(inboxItem?.readAt).toBeNull();
    const marked = await updateInbox(
      jsonRequest("/api/notifications", { id: inboxItem.id }, origin, "PATCH"),
    );
    expect(marked.status).toBe(200);
    const refreshedInbox = await getInbox(
      new NextRequest(`${origin}/api/notifications?limit=100`),
    );
    const refreshed = await refreshedInbox.json();
    expect(
      refreshed.rows.find(
        (row: { id: string; readAt: string | null }) => row.id === inboxItem.id,
      )?.readAt,
    ).not.toBeNull();
    await session.companyToken.update({
      where: { id: tokenRow.id },
      data: { revokedAt: new Date() },
    });
  });

  it("issues a shared public link that can create requests for any active company", async () => {
    const issuedResponse = await issueAllCompaniesToken(
      new NextRequest(`${origin}/api/company-links`, {
        method: "POST",
        headers: { origin },
      }),
    );
    expect(issuedResponse.status).toBe(200);
    const issued = await issuedResponse.json();
    const token = new URL(issued.publicLink).pathname.split("/").pop()!;
    const tokenRow = await session.companyToken.findUniqueOrThrow({
      where: {
        tokenHash: createHash("sha256").update(token).digest("hex"),
      },
    });
    allCompaniesTokenId = tokenRow.id;
    rateLimitKeys.push(`public-link:${tokenRow.id}:${otherCompany.id}`);
    expect(tokenRow.companyId).toBeNull();

    const publicPage = await getPublicRequestPage(
      new NextRequest(`${origin}/api/public/${token}/requests`),
      { params: Promise.resolve({ token }) },
    );
    expect(publicPage.status).toBe(200);
    const pageData = await publicPage.json();
    expect(pageData.company).toBeNull();
    expect(pageData.companies).toContainEqual({
      id: otherCompany.id,
      name: `API second company ${suffix}`,
      mall: `API second mall ${suffix}`,
    });

    const body = {
      companyId: otherCompany.id,
      representativeName: "Shared Link Representative",
      amount: "75.00",
      phone: "+9647701234567",
      idempotencyKey: `public-all-${suffix}`,
    };
    const response = await createPublicRequest(
      jsonRequest(`/api/public/${token}/requests`, body),
      { params: Promise.resolve({ token }) },
    );
    expect(response.status).toBe(201);
    const created = await session.paymentRequest.findUniqueOrThrow({
      where: { idempotencyKey: body.idempotencyKey },
    });
    expect(created).toMatchObject({
      companyId: otherCompany.id,
      mallId: otherMall.id,
      createdByCompanyTokenId: tokenRow.id,
    });
  });

  it("disables companies and malls without restoring revoked public links", async () => {
    const oldToken = randomUUID().replaceAll("-", "");
    const oldTokenRow = await session.companyToken.create({
      data: {
        companyId: company.id,
        tokenHash: createHash("sha256").update(oldToken).digest("hex"),
      },
    });
    const companyResponse = await updateCompany(
      jsonRequest(`/api/companies/${company.id}`, { active: false }, origin, "PATCH"),
      { params: Promise.resolve({ id: company.id }) },
    );
    expect(companyResponse.status).toBe(200);
    expect(
      (await session.companyToken.findUniqueOrThrow({
        where: { id: oldTokenRow.id },
      })).revokedAt,
    ).not.toBeNull();
    expect(
      (
        await getPublicRequestPage(
          new NextRequest(`${origin}/company/${oldToken}`),
          { params: Promise.resolve({ token: oldToken }) },
        )
      ).status,
    ).toBe(404);

    const enabledCompany = await updateCompany(
      jsonRequest(`/api/companies/${company.id}`, { active: true }, origin, "PATCH"),
      { params: Promise.resolve({ id: company.id }) },
    );
    expect(enabledCompany.status).toBe(200);
    expect(
      (
        await getPublicRequestPage(
          new NextRequest(`${origin}/company/${oldToken}`),
          { params: Promise.resolve({ token: oldToken }) },
        )
      ).status,
    ).toBe(404);

    const mallResponse = await updateMall(
      jsonRequest(`/api/malls/${mall.id}`, { active: false }, origin, "PATCH"),
      { params: Promise.resolve({ id: mall.id }) },
    );
    expect(mallResponse.status).toBe(200);
    const newTokenResponse = await issueCompanyToken(
      new NextRequest(`${origin}/api/companies/${company.id}/token`, {
        method: "POST",
        headers: { origin },
      }),
      { params: Promise.resolve({ id: company.id }) },
    );
    expect(newTokenResponse.status).toBe(409);

    const enabledMall = await updateMall(
      jsonRequest(`/api/malls/${mall.id}`, { active: true }, origin, "PATCH"),
      { params: Promise.resolve({ id: mall.id }) },
    );
    expect(enabledMall.status).toBe(200);
    const replacementResponse = await issueCompanyToken(
      new NextRequest(`${origin}/api/companies/${company.id}/token`, {
        method: "POST",
        headers: { origin },
      }),
      { params: Promise.resolve({ id: company.id }) },
    );
    expect(replacementResponse.status).toBe(200);
    const replacement = await replacementResponse.json();
    expect(
      (
        await getPublicRequestPage(
          new NextRequest(replacement.publicLink),
          { params: Promise.resolve({ token: replacement.publicLink.split("/").pop()! }) },
        )
      ).status,
    ).toBe(200);
  });
});
