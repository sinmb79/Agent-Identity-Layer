import { randomBytes } from "node:crypto";
import { getDb } from "../lib/db.mjs";
import { generateOwnerKeypair, generateOtp } from "../lib/crypto.mjs";

export async function ownersRoutes(fastify) {
  /**
   * POST /owners/register
   *
   * Registers a new owner and issues their EC P-256 keypair.
   * The private key is returned once and never stored by 22B Labs.
   */
  fastify.post(
    "/owners/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
            org: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, org = null } = request.body;
      const db = getDb();

      const existing = db.prepare("SELECT id FROM owners WHERE email = ?").get(email);
      if (existing) {
        return reply.code(409).send({
          error: "email_already_registered",
          message: "An owner with this email already exists.",
        });
      }

      const { owner_key_id, public_key_jwk, private_key_jwk } =
        await generateOwnerKeypair();

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO owners (id, email, org, public_key_jwk, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(owner_key_id, email, org, JSON.stringify(public_key_jwk), now);

      const otp = generateOtp();
      const otpId = randomBytes(8).toString("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      db.prepare(
        "INSERT INTO owner_otps (id, owner_id, otp, expires_at) VALUES (?, ?, ?, ?)"
      ).run(otpId, owner_key_id, otp, expiresAt);

      // Email sending is stubbed — OTP logged to server console
      fastify.log.info(`[EMAIL STUB] To: ${email} | OTP: ${otp} | Expires: ${expiresAt}`);

      return reply.code(201).send({
        owner_key_id,
        public_key_jwk,
        private_key_jwk,
        message:
          "Keypair issued. Verify your email with POST /owners/verify-email. " +
          "Store your private key securely — it will not be shown again.",
        _dev_otp: otp,
      });
    }
  );

  /**
   * POST /owners/verify-email
   *
   * Confirms email ownership using the OTP sent during registration.
   */
  fastify.post(
    "/owners/verify-email",
    {
      schema: {
        body: {
          type: "object",
          required: ["owner_key_id", "otp"],
          properties: {
            owner_key_id: { type: "string" },
            otp: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { owner_key_id, otp } = request.body;
      const db = getDb();

      const owner = db
        .prepare("SELECT id, email_verified FROM owners WHERE id = ?")
        .get(owner_key_id);

      if (!owner) {
        return reply.code(404).send({ error: "owner_not_found" });
      }

      if (owner.email_verified) {
        return reply.send({ verified: true, owner_key_id, message: "Already verified." });
      }

      const record = db
        .prepare(
          `SELECT id FROM owner_otps
           WHERE owner_id = ? AND otp = ? AND used = 0 AND expires_at > ?`
        )
        .get(owner_key_id, otp, new Date().toISOString());

      if (!record) {
        return reply.code(400).send({
          error: "invalid_otp",
          message: "OTP is incorrect, expired, or already used.",
        });
      }

      db.exec("BEGIN");
      try {
        db.prepare("UPDATE owners SET email_verified = 1 WHERE id = ?").run(owner_key_id);
        db.prepare("UPDATE owner_otps SET used = 1 WHERE id = ?").run(record.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      return reply.send({ verified: true, owner_key_id });
    }
  );
}
