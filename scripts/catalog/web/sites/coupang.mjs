// Site adapter. parse() is written in S3 after the S2 pilot pages show the real page structure.
const BLOCK_TEXT = /captcha|보안\s*확인|자동입력\s*방지|비정상적인\s*(?:접근|트래픽)|access\s*denied|unusual\s*traffic/i;
export const isBlocked = ({ status, html }) => status === 403 || status === 429 || BLOCK_TEXT.test(html.slice(0, 200000));
