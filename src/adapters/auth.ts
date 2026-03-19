/**
 * OpenCode server authentication.
 *
 * OpenCode servers require HTTP Basic Auth with username "opencode"
 * and a password. The password is available via the OPENCODE_SERVER_PASSWORD
 * environment variable, which is set when OpenCode starts.
 */
export function getOpenCodeAuthHeaders(): Record<string, string> {
  const password = process.env.OPENCODE_SERVER_PASSWORD || '';
  if (!password) {
    return {};
  }
  const credentials = Buffer.from(`opencode:${password}`, 'utf8').toString('base64');
  return {
    'Authorization': `Basic ${credentials}`,
  };
}
