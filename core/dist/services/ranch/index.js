"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { getState } = require('./state');
const { prepareAction, operate } = require('./actions');
module.exports = { getRanchState: getState, prepareRanchAction: prepareAction, operateRanch: (action, input) => action === 'restock' ? require('./restock').restock() : operate(action, input) };
//# sourceMappingURL=index.js.map