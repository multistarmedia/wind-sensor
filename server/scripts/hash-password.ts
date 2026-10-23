// Generate OWNER_PASSWORD_HASH. With no argument, a strong random password is generated and printed once.
//   npm run hash-password
//   npm run hash-password -- 'my own long password'
import crypto from 'node:crypto';
import { hashPassword } from '../auth';

const supplied = process.argv[2];
if (supplied !== undefined && supplied.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
const password = supplied ?? crypto.randomBytes(18).toString('base64url');
if (!supplied) console.log(`Owner password (save it now, it is not stored): ${password}`);
console.log(`OWNER_PASSWORD_HASH='${hashPassword(password)}'`);
