import { handle } from '../apps/api/handler.js';
export default { fetch: (request: Request) => handle(request, 'access') };
