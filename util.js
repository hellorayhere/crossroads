const { customAlphabet } = require('nanoid');

const idGen = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 18);
const newId = () => idGen();

/* Human-friendly 16-character invite code. The alphabet omits easily-confused
   characters (0/O, 1/l/I) so codes can be read aloud and retyped safely. */
const inviteGen = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', 16);
const newInviteCode = () => inviteGen();

const DISC_COLORS = ['#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245', '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB', '#E91E63'];
const randomColor = () => DISC_COLORS[Math.floor(Math.random() * DISC_COLORS.length)];

// Random 4-digit discriminator (0001-9999)
const randomDiscriminator = () => String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');

module.exports = { newId, newInviteCode, randomColor, randomDiscriminator, DISC_COLORS };
