import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

async function readHidden(prompt: string): Promise<string> {
  if (!input.isTTY || !input.setRawMode) {
    throw new Error(
      "Run this command in an interactive terminal to enter a password safely.",
    );
  }

  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let password = "";
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      input.off("data", onData);
      input.off("error", onError);
      input.setRawMode(false);
      input.pause();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onData = (buffer: Buffer) => {
      for (const character of decoder.write(buffer)) {
        if (character === "\u0003" || character === "\u0004") {
          cleanup();
          reject(new Error("Password entry cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          output.write("\n");
          cleanup();
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
        } else if (character >= " ") {
          password += character;
        }
      }
    };

    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    input.on("error", onError);
  });
}

const rl = createInterface({ input, output });
let prisma: PrismaClient | undefined;

try {
  const email = (await rl.question("Admin email: ")).trim().toLowerCase();
  const validEmail = z.string().email().max(254).safeParse(email);
  if (!validEmail.success) {
    throw new Error("A valid admin email address is required.");
  }

  // Connect only after collecting the email; this command must use the intended
  // DATABASE_URL (and DIRECT_URL if configured) for the database to be changed.
  prisma = new PrismaClient();
  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (existing) {
    output.write(
      `An admin account for ${email} already exists.\n` +
        "This will replace its password and reactivate the account.\n",
    );
    const confirmation = (
      await rl.question('Type RESET to confirm, or anything else to cancel: ')
    ).trim();
    if (confirmation !== "RESET") {
      output.write("Cancelled. No changes were made.\n");
      process.exitCode = 0;
    } else {
      const name =
        (await rl.question(`Admin name [${existing.name}]: `)).trim() ||
        existing.name;
      const password = await readHidden(
        "New admin password (12+ characters, hidden): ",
      );
      if (password.length < 12 || password.length > 200) {
        throw new Error("Password must be between 12 and 200 characters.");
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.$transaction([
        prisma.adminUser.update({
          where: { id: existing.id },
          data: { name, passwordHash, active: true },
        }),
        prisma.auditLog.create({
          data: {
            adminId: existing.id,
            action: "ADMIN_PASSWORD_RESET",
            entityType: "AdminUser",
            entityId: existing.id,
            metadata: { method: "interactive_cli" },
          },
        }),
      ]);
      output.write("Admin password reset successfully. Keep it secure.\n");
    }
  } else {
    const name =
      (await rl.question("Admin name [مدير النظام]: ")).trim() ||
      "مدير النظام";
    const password = await readHidden(
      "Admin password (12+ characters, hidden): ",
    );
    if (password.length < 12 || password.length > 200) {
      throw new Error("Password must be between 12 and 200 characters.");
    }

    await prisma.adminUser.create({
      data: { email, name, passwordHash: await bcrypt.hash(password, 12) },
    });
    output.write("Admin created. Keep the password secure.\n");
  }
} finally {
  rl.close();
  await prisma?.$disconnect();
}
