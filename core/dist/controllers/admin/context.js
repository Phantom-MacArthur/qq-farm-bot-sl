"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function createAdminContext(dataProvider) {
    return {
        app: null,
        server: null,
        io: null,
        provider: dataProvider,
    };
}
module.exports = { createAdminContext };
//# sourceMappingURL=context.js.map