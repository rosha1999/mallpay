import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

async function readHidden(prompt: string): Promise<string> {
  if (!input.isTTY || !input.setRawMode)
    throw new Error(
      "Run this command in an interactive terminal to enter a password safely.",
    );

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
const email = (await rl.question("Admin email: ")).trim().toLowerCase();
const name = (await rl.question("Admin name: ")).trim() || "مدير النظام";
rl.close();

const validEmail = z.string().email().max(254).safeParse(email);
if (!validEmail.success)
  throw new Error("A valid admin email address is required.");

const password = await readHidden("Admin password (12+ characters, hidden): ");
if (password.length < 12 || password.length > 200)
  throw new Error("Password must be between 12 and 200 characters.");

const prisma = new PrismaClient();
try {
  await prisma.adminUser.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, 12) },
  });
  console.log("Admin created. Keep the password secure.");
} catch (error) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    throw new Error("An admin with this email already exists.");
  throw error;
} finally {
  await prisma.$disconnect();
}
