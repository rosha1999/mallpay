import { PrismaClient } from "@prisma/client";

if (
  process.env.NODE_ENV === "production" ||
  process.env.ALLOW_DEMO_SEED !== "true"
) {
  throw new Error(
    "Demo seed is disabled. Set ALLOW_DEMO_SEED=true outside production to continue.",
  );
}

const prisma = new PrismaClient();
const seedNote = "بيانات تجريبية — احذفها قبل الاستخدام الفعلي";

async function main() {
  const mallNames = ["مول أربيل", "مول كركوك", "مول السليمانية"];
  const malls = [];
  for (const name of mallNames) {
    malls.push(
      await prisma.mall.upsert({
        where: { name },
        update: {},
        create: { name, location: "بيانات تجريبية" },
      }),
    );
  }

  const companyNames = [
    "شركة ABC",
    "شركة XYZ",
    "شركة ALFA",
    "شركة GHI",
    "شركة KLM",
    "شركة نور",
  ];

  for (const [index, name] of companyNames.entries()) {
    const mall = malls[index % malls.length];
    const company = await prisma.company.upsert({
      where: { name_mallId: { name, mallId: mall.id } },
      update: {},
      create: {
        name,
        mallId: mall.id,
        contactName: "بيانات تجريبية",
        phone: "0000000000",
      },
    });

    const idempotencyKey = `seed-demo:${company.id}`;
    const existingRequest =
      (await prisma.paymentRequest.findUnique({
        where: { idempotencyKey },
        include: { payments: true },
      })) ??
      (await prisma.paymentRequest.findFirst({
        where: { companyId: company.id, note: seedNote },
        include: { payments: true },
      }));
    const terminalStatus = existingRequest
      ? ["REJECTED", "CANCELLED", "PAID"].includes(existingRequest.status)
      : false;
    const preserveRequest = Boolean(
      existingRequest && (terminalStatus || existingRequest.payments.length),
    );
    const scheduledAt =
      existingRequest?.appointmentAt ??
      existingRequest?.dueAt ??
      new Date(Date.now() + (index - 2) * 86_400_000);
    await prisma.$transaction(async (tx) => {
      const request = existingRequest
        ? await tx.paymentRequest.update({
            where: { id: existingRequest.id },
            data: {
              dueAt: terminalStatus ? existingRequest.dueAt : scheduledAt,
              appointmentAt: terminalStatus
                ? existingRequest.appointmentAt
                : scheduledAt,
              status: preserveRequest ? existingRequest.status : "APPROVED",
              note: seedNote,
              idempotencyKey,
            },
          })
        : await tx.paymentRequest.create({
            data: {
              companyId: company.id,
              mallId: mall.id,
              amount: (index + 1) * 500_000,
              dueAt: scheduledAt,
              appointmentAt: scheduledAt,
              status: "APPROVED",
              note: seedNote,
              idempotencyKey,
            },
          });

      if (["REJECTED", "CANCELLED", "PAID"].includes(request.status)) {
        await tx.appointment.updateMany({
          where: { requestId: request.id, status: "SCHEDULED" },
          data: { status: "CANCELLED" },
        });
        return;
      }

      const scheduled = await tx.appointment.findMany({
        where: { requestId: request.id, status: "SCHEDULED" },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });
      const keep = scheduled[0];
      if (scheduled.length > 1) {
        await tx.appointment.updateMany({
          where: {
            requestId: request.id,
            status: "SCHEDULED",
            id: { not: keep.id },
          },
          data: { status: "RESCHEDULED" },
        });
      }

      if (keep) {
        await tx.appointment.update({
          where: { id: keep.id },
          data: { scheduledAt, note: "موعد تجريبي" },
        });
      } else {
        await tx.appointment.create({
          data: {
            companyId: company.id,
            requestId: request.id,
            scheduledAt,
            status: "SCHEDULED",
            note: "موعد تجريبي",
          },
        });
      }
    });
  }

  console.log(
    "Seed data created (DEMO). This command is disabled in production.",
  );
}

main().finally(() => prisma.$disconnect());
