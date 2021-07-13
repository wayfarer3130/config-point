/**
 * Contains the model data for the extensibility level points.
 * This is implicitly updated by the add/update configuration values.
 */
let _configPoints = {};

const configOperation = (configOperation, props) => ({ 
  configOperation,
  isOperation(src) { return (src && src.configOperation==this.configOperation) },
  create(props) { return {...props, configOperation:this.configOperation}; },
  at(position,value,props) { return this.create({...props,position,value})},
  ...props,
 });

// Indicates that this is the default configuration operation
export const InsertOp = configOperation('insert', {
  perform({sVal, base, context}) {
    if (sVal.position != null) {
      base.splice(sVal.position, 0, mergeCreate(sVal.value, context));
    }
    return base;
  },
});

// Indicates that this is a delete or remove operation
export const DeleteOp = configOperation('delete',{
  perform({base, bKey, sVal}) {
    if( isArray(base) ) {
      base.splice(sVal.position,1);
    } else {
      delete base[bKey];
    }
    return base;
  },
}); 

/**
  * Reference to other values operation.
  * createCurrent creates an object the references the current ConfigPoint value, with the form:
  * { configOperation: 'reference', reference: 'nameOfReference' }
  */
export const ReferenceOp = configOperation('reference',{
  createCurrent(reference) { return {reference, configOperation: this.configOperation }; },
  perform({sVal, context}) {
    return context && context[sVal.reference];
  },
}); 

/**
  * Indicates that this is a reference operation.
  */
 export const ReplaceOp = configOperation('reference',{
  perform({sVal, context,base,bKey}) {
    return base[bKey] = mergeCreate(sVal, context);
  },
}); 

/**
 * Indicates if any is a primitive value, eg not an object or function.
 * 
 * @param {any} val 
 * @returns true if val is primitive
 */
function isPrimitive(val) {
  const tof = typeof (val);
  return val === null || val === undefined || tof == 'number' || tof == 'boolean' || tof == 'string' || tof == 'bigint';
}

/** Creates an object of the same type as src, but as a new copy so that it can be 
 * modified later on.
 * For reference instances, creates a copy of the referenced object.
 * For primitives, returns the primitive.
 * Arrays and objects creates a copy
 * Functions, returns the original function (TBD on how to copy those)
 */
export const mergeCreate = function (src, context) {
  if (ReferenceOp.isOperation(src)) {
    return ReferenceOp.perform({sVal: src,context});
  }

  if (isPrimitive(src)) {
    return src;
  }
  const tof = typeof (src);
  if (tof === 'function') {
    // TODO - decide between returning raw original and copied/updated value
    return src;
  }
  if (tof === 'object') {
    return mergeObject(isArray(src) ? [] : {}, src, context);
  }
  throw new Error(`The value ${src} of type ${tof} isn't a known type for merging.`);
}

// Returns the relevant key to use, current, just returns key itself.
function mergeKey(base, key) {
  return key;
}

/** Indiciates of the object is an array. */
function isArray(src) {
  return typeof (src) == 'object' && typeof (src.length) == 'number';
}

/**
 * Merges into base[key] the value from src[key], if any.  This can end up remove
 * base[key], merging into it, replacing it or modifying the value.
 * @param {*} base 
 * @param {*} src 
 * @param {*} key 
 * @param {*} context 
 * @returns 
 */
export function mergeAssign(base, src, key, context) {
  const bKey = mergeKey(base, key, context);
  const bVal = base[bKey];
  let sVal = src[key];
  if ( DeleteOp.isOperation(sVal) ) {
    return DeleteOp.perform({sVal,base,bKey, key});
  }

  if (isArray(bVal) && sVal==null ) return base;

  if (InsertOp.isOperation(sVal)) {
    return InsertOp.perform({sVal, base, context});
  }

  if (isPrimitive(bVal)) {
    return base[bKey] = mergeCreate(sVal, context);
  }

  if (ReplaceOp.isOperation(sVal)) {
    return ReplaceOp.perform({base,bKey,sVal,context});
  }

  return mergeObject(bVal, sVal, context);
}

/**
 * mergeObject is a deep Object.assign replacement with enhanced merge/update functionality.
 * If the base value (being assigned to) has a property P, and the src value also has P, then
 * base.P isn't replaced with src.P, but is instead merged.
 * As well, if src.P is one of the operations defined above (ReplaceOp, DeleteOp etc), then instead of
 * base.P being assigned from src.P, the src.P operation method "perform" is run instead, which can
 * delete base.P, replace  base.P, insert into a list or remove from a list.
 * TODO - add the SortedListOp to create sorted lists.
 * @param {object|function} base 
 * @param {*} src 
 * @param {*} context 
 * @returns 
 */
export function mergeObject(base, src, context) {
  for (const key in src) {
    mergeAssign(base, src, key, context);
  }
  return base;
}

const ConfigPointFunctionality = {
  /**
   * Extends the configuration on this config point instance with the data in data by adding data to the lsit
   * of config point extensions, and then applying all the existing extensions to generate the config point.
   * @param {*} data 
   * @returns this object.
   */
  extendConfig(data) {
    const name = data.name || ("_order" + this._extensions._order.length);
    const toRemove = this._extensions[name];
    if (toRemove) {
      throw new Error(`Level already has extension ${name}`);
    }
    this._extensions[name] = data;
    this._extensions._order.push(data);
    this.applyExtensions();
    return this;
  },

  /**
   * Applies all the extensions onto this config point, by starting with merging the configuration base, then
   * for each item in the extension, merging it into the resulting object.
   * Directly modifies this.
   */
  applyExtensions() {
    mergeObject(this, this._configBase, this._configBase);
    for (const item of this._extensions._order) {
      mergeObject(this, item, this);
    }
  },
};

const BaseImplementation = {
  /** Adds a new configuraiton point, must get executed before the level is used.
   * It isn't necessary to provide a default configBase, but doing so enables
   * inheritting from the levelBase to provide other functionality for the given level.
   * The ordering of when addConfig is called to provide configBase doesn't matter much.
   */
  addConfig(configName, configBase) {
    if (typeof (configBase) === 'string') {
      if (configBase === configName) throw new Error(`The configuration point ${configName} uses itself as a base`);
      configBase = this.addConfig(configBase);
    }
    let config = _configPoints[configName];
    if (!config) {
      _configPoints[configName] = config = Object.assign({}, ConfigPointFunctionality);
      config._configBase = configBase;
      config._extensions = { _order: [] };
    } else if (configBase) {
      config._configBase = configBase;
    }
    if (configBase) {
      config.applyExtensions();
    }
    return config;
  },

  /** Registers the specified configuration items.
   * The format of config is an array of extension items.
   * Each item has a configName for the top level config to change,
   * and then has configBase to set the base configuration.
   * The base extension, with an extension item or
   * basedOn, to base the extension on another existing configuration.
   * @param {Array|ConfigItem}} config elements to add to the ConfigPoint values.
   */
  register(...config) {
    let ret = {};
    config.forEach( (configItem) => {
      if( isArray(configItem) ) {
        ret = {...ret, ...this.register(...configItem)};
        return;
      }
      const { configName, configBase, extension } = configItem;
      if (configBase) {
        ret[configName] = this.addConfig(configName, configBase);
      }
      if (extension) {
        ret[configName] = this.addConfig(configName).extendConfig(extension);
      }
    });
    return ret;
  },

  // Indicate of the given configuration item exists.
  hasConfig(configName) {
    return _configPoints[configName] != undefined;
  },

  // Clear all configuration items, mostly used for test purposes.
  clear() {
    _configPoints = {};
  }
};

export const ConfigPoint = { name: 'ConfigPoint', ...BaseImplementation};

export default ConfigPoint;

// TODO - find a way to allow loading a safe list of configuration elements
// Make this globally available for now until a better method is found
// window.ConfigPoint = ConfigPoint;
