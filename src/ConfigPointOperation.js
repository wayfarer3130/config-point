import ConfigPoint from "./ConfigPoint";
import {mergeCreate} from "./ConfigPoint";

/**
 * Contains the model data for the extensibility level points.
 * This is implicitly updated by the add/update configuration values.
 */
let _configPoints = {};

const configOperation = (configOperation, props) => ({
  _configOperation: configOperation,
  create(props) { return { ...props, configOperation: this._configOperation }; },
  at(position, value, props) { return this.create({ ...props, position, value }) },
  ...props,
});

// Indicates that this is the default configuration operation
const InsertOp = configOperation('insert', {
  immediate({ sVal, base, context }) {
    if (sVal.position != null) {
      base.splice(sVal.position, 0, mergeCreate(sVal.value, context));
    }
    return base;
  },
});

// Indicates that this is a delete or remove operation
const DeleteOp = configOperation('delete', {
  immediate({ base, bKey, sVal }) {
    if (Array.isArray(base)) {
      base.splice(sVal.position, 1);
    } else if( base ) {
      delete base[bKey];
    }
    return base;
  },
});

/**
  * Reference to other values operation.
  * createCurrent creates an object the references the current ConfigPoint value, with the form:
  *    configOperation: 'reference',
  *    reference: 'nameOfReference'
  *    source?: where the object is coming from, 'ConfigPoint' means it is an external config point object
  * By default the reference value refers to an item in the current "context", which is usually a base value of the current
  * configuration item being created.  It is 
  * Warning: There is no ordering to the reference within a given set of object creates.  That means you cannot
  * necessarily reference something created in the configuration object, only pre-existing objects should be
  * referenced.
  * For ConfigPoint references, a value will be created if one does not exist.
  */
export const ReferenceOp = configOperation('reference', {
  createCurrent(reference,props) { return this.create({ reference, ...props });  },
  getter({ base, context, bKeyHidden }) {
    const {reference, transform, source} = base[bKeyHidden];
    const useContext = source ? ConfigPoint.addConfig(source) : context;
    if( source && !reference ) return useContext;
    if( reference===bKeyHidden ) throw new Error(`Reference ${reference} and internal key ${bKeyHidden} must be different`);
    if( !useContext ) return;
    const ret = useContext[reference];
    return transform ? transform(ret) : ret;
  },
});

/**
  * Indicates that this is a reference operation.
  */
export const ReplaceOp = configOperation('replace', {
  immediate({ sVal, context, base }) {
    return base.splice(sVal.position,1,mergeCreate(sVal.value, context));
  },
});

/**
 * Indicates that this is a sort operation operation.
 * A sort operation takes the parameters:
 *    valueReference - the attribute name to extract as the value, if not provided, defaults to the entire object
 *    sortKey - the attribute name to sort on.  If not provided, defaults to the value object
 *    reference - the attribute that this instance copies for the source material
 * The sorting is performed on the referenced value, which can be a list or an object.  If an object, then all values
 * from the object are considered to be part of the initial sort order.
*/
const SortOp = configOperation('sort', {
  createSort(reference, sortKey, valueReference, props) {
    return this.create({ original: [], ...props, reference, sortKey, valueReference });
  },
  getter({base, bKeyHidden, context}) {
    const {original,valueReference, sortKey, reference} = base[bKeyHidden];
    // This implicitly removes all elements of original
    const referenceValue = reference ? context[reference] : original;
    if( reference ) {
      original.length = 0;
    } 

    const compare = (a, b) => {
      const valueA = valueReference ? a[valueReference] : a;
      const valueB = valueReference ? b[valueReference] : b;
      const sortA = sortKey ? a[sortKey] : valueA;
      const sortB = sortKey ? b[sortKey] : valueB;
      if (sortA === sortB) return 0;
      return sortA < sortB ? -1 : 1;
    };
    if (!referenceValue) return original;
    let result = Object.values(referenceValue).filter(value => (value != null && (!valueReference || value[valueReference])));
    if (sortKey) {
      result = result.filter(value => value[sortKey] !== null);
    }
    result.sort(compare);
    result = result.map(item => (valueReference ? item[valueReference] : item));
    original.splice(0, original.length, ...result);
    return original;
  },
});

export const SafeOp = configOperation('safe', {
  createCurrent(reference,props) { return this.create({ reference, ...props  });  },
  getter({ base, context, bKeyHidden }) {
    const {reference, source} = base[bKeyHidden];
    const useContext = source ? ConfigPoint.addConfig(source) : context;
    if( reference===bKeyHidden ) throw new Error(`Reference ${reference} and internal key ${bKeyHidden} must be different`);
    if( !useContext ) return;
    const ret = useContext[reference];
    return safeFunction(ret);
  },
});

const { ConfigPointOperation } = ConfigPoint.registerRoot({
  ConfigPointOperation: {
    configBase: {
      sort: SortOp,   
      insert: InsertOp,
      'delete': DeleteOp,  
      safe: SafeOp,
      reference: ReferenceOp,
      replace: ReplaceOp,
    }
  },
});

var reg = /(?:[a-z$_][a-z0-9$_]*(\.[a-z0-9$_]*)*)|(?:[;\\])|(?:"[^"]*")|(?:'[^']*')/ig;

function safeFunction(textExpression) {
  // console.log('safeFunction', textExpression);
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

export {ConfigPointOperation, SortOp, DeleteOp, InsertOp, safeFunction};
export default ConfigPointOperation;
