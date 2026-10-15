// Generates MPESA_SECURITY_CREDENTIAL: the B2B initiator password encrypted with
// Safaricom's public certificate (RSA, PKCS#1 v1.5, base64).
//
//   INITIATOR_PASSWORD='...' node scripts/mpesa-security-credential.mjs path/to/cert.cer
//
// Use the sandbox certificate for sandbox and the production certificate for production
// (both are downloadable from developer.safaricom.co.ke). The password comes from an env var so
// it stays out of your shell history.
import { constants, publicEncrypt } from "node:crypto";
import { readFileSync } from "node:fs";

const certPath = process.argv[2];
const password = process.env.INITIATOR_PASSWORD;
if (!certPath || !password) {
  console.error("Usage: INITIATOR_PASSWORD='...' node scripts/mpesa-security-credential.mjs <cert.cer>");
  process.exit(1);
}
const encrypted = publicEncrypt(
  { key: readFileSync(certPath), padding: constants.RSA_PKCS1_PADDING },
  Buffer.from(password),
);
console.log(encrypted.toString("base64"));
