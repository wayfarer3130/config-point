import {ConfigPoint, InsertOp, DeleteOp, ReferenceOp, SortOp} from './ConfigPoint';

var reg = /(?:[a-z$_][a-z0-9$_]*(\.[a-z0-9$_]*)*)|(?:[;\\])|(?:"[^"]*")|(?:'[^']*')/ig;

function safeFunction(textExpression) {
  console.log('safeFunction', textExpression);
  if( !textExpression ) return;
  const safeExpr = textExpression.replace(reg,(val0) => {
    // console.log('Match', val0);
    if( val0.indexOf("Math.")===0 ) return val0;
    if( val0[0]==='"' || val0[0]==="'" ) return val0;
    return 'this.'+val0;
  });
  let fn = Function(`"use strict"; var $data = this;return (${safeExpr})`)
  return (contextData) => fn.bind(contextData)();
}

export default ConfigPoint;
export { ConfigPoint, InsertOp, DeleteOp, ReferenceOp, SortOp, safeFunction };
