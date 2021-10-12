import JSON5 from 'json5';

/**
 * Contains the model data for the extensibility level points.
 * This is implicitly updated by the add/update configuration values.
 */
let _configPoints = {};

const configOperation = (configOperation, props) => ({
  configOperation,
  isOperation(src) { return (src && src.configOperation == this.configOperation) },
  create(props) { return { ...props, configOperation: this.configOperation }; },
  at(position, value, props) { return this.create({ ...props, position, value }) },
  ...props,
});

// Indicates that this is the default configuration operation
export const InsertOp = configOperation('insert', {
  perform({ sVal, base, context }) {
    if (sVal.position != null) {
      base.splice(sVal.position, 0, mergeCreate(sVal.value, context));
    }
    return base;
  },
});

// Indicates that this is a delete or remove operation
export const DeleteOp = configOperation('delete', {
  perform({ base, bKey, sVal }) {
    if (isArray(base)) {
      base.splice(sVal.position, 1);
    } else {
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
  createCurrent(reference) { return { reference, configOperation: this.configOperation }; },
  perform({ sVal, context }) {
    const useContext = sVal.source ? ConfigPoint.addConfig(sVal.source) : context;
    if( sVal.source && !sVal.reference ) return useContext;
    return mergeCreate(useContext && useContext[sVal.reference], context);
  },
});

/**
  * Indicates that this is a reference operation.
  */
export const ReplaceOp = configOperation('replace', {
  perform({ sVal, context, base, bKey }) {
    return base[bKey] = mergeCreate(sVal, context);
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
export const SortOp = configOperation('sort', {
  createSort(reference, sortKey, valueReference, props) {
    return this.create({ ...props, reference, sortKey, valueReference });
  },
  performSort(original, sVal, context) {
    const { valueReference, sortKey, reference } = sVal;
    if (reference == undefined) throw Error('reference isnt defined');
    const referenceValue = context[reference];
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
  perform({ sVal, context }) {
    if (context) {
      if (!context.postOperation) context.postOperation = [];
      let original = [];
      context.postOperation.push(this.performSort.bind(context, original, sVal, context));
      return original;
    }
    return [];
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
export const mergeCreate = function (sVal, context) {
  if (ReferenceOp.isOperation(sVal)) {
    return ReferenceOp.perform({ sVal, context });
  }
  if (SortOp.isOperation(sVal)) {
    return SortOp.perform({ sVal, context });
  }

  if (isPrimitive(sVal)) {
    return sVal;
  }
  const tof = typeof (sVal);
  if (tof === 'function') {
    // TODO - decide between returning raw original and copied/updated value
    return sVal;
  }
  if (tof === 'object') {
    return mergeObject(isArray(sVal) ? [] : {}, sVal, context);
  }
  throw new Error(`The value ${sVal} of type ${tof} isn't a known type for merging.`);
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
  if (DeleteOp.isOperation(sVal)) {
    return DeleteOp.perform({ sVal, base, bKey, key });
  }

  if (isArray(bVal) && sVal == null) return base;

  if (InsertOp.isOperation(sVal)) {
    return InsertOp.perform({ sVal, base, context });
  }

  if (isPrimitive(bVal)) {
    return base[bKey] = mergeCreate(sVal, context);
  }

  if (ReplaceOp.isOperation(sVal)) {
    return ReplaceOp.perform({ base, bKey, sVal, context });
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
    if (this._preExistingKeys) {
      for (const key of Object.keys(this)) {
        if (!this._preExistingKeys[key]) delete this[key];
      }
    } else {
      this._preExistingKeys = {};
      this._preExistingKeys = Object.keys(this).reduce((keyset, key) => {
        keyset[key] = true;
        return keyset;
      }, this._preExistingKeys);
    }
    this._applyExtensionsTo(this);

    if (this.postOperation) {
      Object.values(this.postOperation).forEach(postOp => postOp());
    }
  },

  /** Applies the extensions from this object to the given result.  Allows for applying nested parent extensions,
   * and includes all the parent configuration before apply this set of extensions.
   */
  _applyExtensionsTo(dest) {
    const configBase = this._configBase;
    if (configBase && configBase._applyExtensionsTo) {
      configBase._applyExtensionsTo(dest);
    } else {
      mergeObject(dest, configBase, dest);
    }
    for (const item of this._extensions._order) {
      mergeObject(dest, item, dest);
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
    config.forEach((configItem) => {
      if (isArray(configItem)) {
        ret = { ...ret, ...this.register(...configItem) };
        return;
      }

      const { configName } = configItem;
      if (configName) {
        const { configBase, extension } = configItem;
        if (configBase) {
          ret[configName] = this.addConfig(configName, configBase);
        }
        if (extension) {
          ret[configName] = this.addConfig(configName).extendConfig(extension);
        }
      } else {
        Object.keys(configItem).forEach(key => {
          const extension = configItem[key];
          const {configBase} = extension;
          ret[key] = this.addConfig(key,configBase).extendConfig(extension);
        });
      }
    });
    return ret;
  },

  // Indicate of the given configuration item exists.
  hasConfig(configName) {
    return _configPoints[configName] != undefined;
  },

  // Gets the given configuration name
  getConfig(config) {
    if (typeof config === 'string') {
      return _configPoints[config];
    }
    return config;
  },

  // Clear all configuration items, mostly used for test purposes.
  clear() {
    _configPoints = {};
  }
};

/**
 * Loads the given value, as specified by the parameter name path. 
 * parameterName is a list of config-point files to load, named  [a-zA-Z0-9]+(\.((js)|(json)))?  Null means load the default
 * The path is the required path prefix (automatically added), and the default name is what to use if nothing is specified.
 * The defaultName parameter is NOT checked for validity, it is assumed to be allowed. 
 */
export const load = (defaultName, path, parameterName) => {
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  let loadNames = defaultName ? [defaultName] : null;
  if (parameterName) {
    const paramValues = urlParams.getAll(parameterName);
    if (paramValues && paramValues.length) {
      paramValues.forEach(item => {
        if (!item.match(/^[a-zA-Z0-9]+$/)) {
          throw new Error(`Parameter ${parameterName} has invalid value ${item}`);
        }
      });
      loadNames = paramValues;
    }
  }
  if (loadNames) {
    loadNames.forEach(name => {
      var oReq = new XMLHttpRequest();
      oReq.addEventListener("load", () => {
        const json = JSON5.parse(oReq.responseText);

        const itemsRegistered = ConfigPoint.register(json);
        // console.log('ConfigPoint:Loaded', name,'registered', itemsRegistered);
      });
      const url = (path && (path + '/' + name) || name) + '.json5';
      oReq.open("GET", url);
      oReq.send();
    });
  } else {
    console.log("ConfigPoint: No names to load");
  }
};

export const ConfigPoint = { name: 'ConfigPoint', ...BaseImplementation, load };

export default ConfigPoint;
