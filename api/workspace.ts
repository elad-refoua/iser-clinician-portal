import { handleWorkspace } from '../apps/api/workspace.js';
export default { fetch: (request: Request) => handleWorkspace(request) };
