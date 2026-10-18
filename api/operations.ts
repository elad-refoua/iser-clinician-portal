import { handleOperations } from '../apps/api/operations.js';
export default { fetch: (request: Request) => handleOperations(request) };
