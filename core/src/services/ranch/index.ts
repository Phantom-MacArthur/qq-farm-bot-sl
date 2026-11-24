export {};

const { getState } = require('./state');
const { prepareAction, operate } = require('./actions');

module.exports = { getRanchState: getState, prepareRanchAction: prepareAction, operateRanch: (action: string, input: any) => action === 'restock' ? require('./restock').restock() : operate(action, input) };
