import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { applyPendingWhatsAppStatusEvents } from "./whatsapp-events";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(
  testDatabaseUrl
    ? { datasources: { db: { url: testDatabaseUrl } } }
    : undefined,
);
const runDatabaseTests = describe.skipIf(!testDatabaseUrl);
const suffix = randomUUID();
let mallA: { id: string } | undefined;
let mallB: { id: string } | undefined;
let companyA: { id: string } | undefined;
let companyB: { id: string } | undefined;
let request: { id: string } | undefined;
let admin: { id: string } | undefined;
let foreignCompanyToken: { id: string } | undefined;
let testNotification: { id: string } | undefined;

runDatabaseTests("PostgreSQL integrity constraints", () => {
  beforeAll(async () => {
    mallA = await prisma.mall.create({ data: { name: `Mall A ${suffix}` } });
    mallB = await prisma.mall.create({ data: { name: `Mall B ${suffix}` } });
    companyA = await prisma.company.create({
      data: { name: `Company A ${suffix}`, mallId: mallA.id },
    });
    companyB = await prisma.company.create({
      data: { name: `Company B ${suffix}`, mallId: mallB.id },
    });
    foreignCompanyToken = await prisma.companyToken.create({
      data: {
        companyId: companyB.id,
        tokenHash: createHash("sha256").update(`${suffix}:token`).digest("hex"),
      },
    });
    admin = await prisma.adminUser.create({
      data: {
        name: "Database invariant test",
        email: `db-test-${suffix}@example.invalid`,
        passwordHash: "not-used",
      },
    });
    request = await prisma.paymentRequest.create({
      data: {
        companyId: companyA.id,
        mallId: mallA.id,
        amount: "100.00",
        status: "APPROVED",
      },
    });
  });

  afterAll(async () => {
    if (testNotification) {
      await prisma.whatsAppStatusEvent.deleteMany({
        where: { providerMessageId: `wamid.${suffix}` },
      });
      await prisma.notification.delete({ where: { id: testNotification.id } });
    }
    const companyIds = [companyA?.id, companyB?.id].filter((id): id is string =>
      Boolean(id),
    );
    if (companyIds.length) {
      await prisma.appointment.deleteMany({
        where: { companyId: { in: companyIds } },
      });
      await prisma.payment.deleteMany({
        where: { companyId: { in: companyIds } },
      });
      await prisma.paymentRequest.deleteMany({
        where: { companyId: { in: companyIds } },
      });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    if (admin) await prisma.adminUser.delete({ where: { id: admin.id } });
    if (mallA) await prisma.mall.delete({ where: { id: mallA.id } });
    if (mallB) await prisma.mall.delete({ where: { id: mallB.id } });
    await prisma.$disconnect();
  });

  it("rejects a request assigned to a mall other than its company's mall", async () => {
    await expect(
      prisma.paymentRequest.create({
        data: {
          companyId: companyA!.id,
          mallId: mallB!.id,
          amount: "10.00",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects zero and negative financial amounts", async () => {
    await expect(
      prisma.paymentRequest.create({
        data: {
          companyId: companyA!.id,
          mallId: mallA!.id,
          amount: "0.00",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.payment.create({
        data: {
          companyId: companyA!.id,
          requestId: request!.id,
          amount: "-1.00",
          method: "CASH",
          adminId: admin!.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects payments and appointments tied to the wrong company", async () => {
    await expect(
      prisma.payment.create({
        data: {
          companyId: companyB!.id,
          requestId: request!.id,
          amount: "1.00",
          method: "CASH",
          adminId: admin!.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.appointment.create({
        data: {
          companyId: companyB!.id,
          requestId: request!.id,
          scheduledAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toThrow();
  });

  it("allows only one scheduled appointment per request", async () => {
    const scheduledAt = new Date(Date.now() + 86_400_000);
    await prisma.appointment.create({
      data: {
        companyId: companyA!.id,
        requestId: request!.id,
        scheduledAt,
        status: "SCHEDULED",
      },
    });
    await expect(
      prisma.appointment.create({
        data: {
          companyId: companyA!.id,
          requestId: request!.id,
          scheduledAt,
          status: "SCHEDULED",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a creator token owned by another company", async () => {
    await expect(
      prisma.paymentRequest.create({
        data: {
          companyId: companyA!.id,
          mallId: mallA!.id,
          amount: "10.00",
          createdByCompanyTokenId: foreignCompanyToken!.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("allows a global creator token to submit for any company", async () => {
    const token = await prisma.companyToken.create({
      data: {
        tokenHash: createHash("sha256")
          .update(`${suffix}:global-token`)
          .digest("hex"),
        revokedAt: new Date(),
      },
    });
    let createdRequestId: string | undefined;
    try {
      const created = await prisma.paymentRequest.create({
        data: {
          companyId: companyA!.id,
          mallId: mallA!.id,
          amount: "10.00",
          createdByCompanyTokenId: token.id,
        },
      });
      createdRequestId = created.id;
      expect(created.companyId).toBe(companyA!.id);
    } finally {
      if (createdRequestId)
        await prisma.paymentRequest.delete({ where: { id: createdRequestId } });
      await prisma.companyToken.delete({ where: { id: token.id } });
    }
  });

  it("reconciles callbacks received before the provider ID was stored", async () => {
    const providerMessageId = `wamid.${suffix}`;
    const deliveredAt = new Date("2026-01-01T00:00:00.000Z");
    const readAt = new Date("2026-01-01T00:02:00.000Z");
    const events = [
      { status: "READ", eventAt: readAt },
      { status: "DELIVERED", eventAt: deliveredAt },
    ] as const;
    testNotification = await prisma.notification.create({
      data: {
        channel: "WHATSAPP",
        deliveryStatus: "SENT",
        message: "webhook event reconciliation test",
        dedupeKey: `whatsapp-test:${suffix}`,
      },
    });
    await prisma.whatsAppStatusEvent.createMany({
      data: events.map((event) => ({
        ...event,
        id: randomUUID(),
        providerMessageId,
        dedupeKey: createHash("sha256")
          .update(`${providerMessageId}:${event.status}`)
          .digest("hex"),
      })),
    });

    await prisma.$transaction(async (tx) => {
      await tx.notification.update({
        where: { id: testNotification!.id },
        data: { providerMessageId },
      });
      await applyPendingWhatsAppStatusEvents(tx, providerMessageId);
    });
    const reconciled = await prisma.notification.findUniqueOrThrow({
      where: { id: testNotification.id },
    });
    expect(reconciled.deliveryStatus).toBe("READ");
    expect(reconciled.deliveredAt?.getTime()).toBe(deliveredAt.getTime());
    expect(reconciled.readAt?.getTime()).toBe(readAt.getTime());
  });
});
