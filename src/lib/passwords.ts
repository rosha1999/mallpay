import bcrypt from "bcryptjs";

const dummyPasswordHash =
  "$2b$12$NQa9yntewaTOTWcojHkLju5cE.lKQ95wtb3SLe3PoLTm.vl.wmZfW";

export async function verifyAdminPassword(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  const matches = await bcrypt.compare(
    password,
    passwordHash ?? dummyPasswordHash,
  );
  return passwordHash !== null && matches;
}
