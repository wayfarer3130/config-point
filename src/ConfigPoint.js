import JSON5 from 'json5';

/**
 * Contains the model data for the extensibility level points.
 * This is implicitly updated by the add/update configuration values.
 */
let _configPoints = {};
const _rootConfigPoints = {};

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

/**
 * 
 * @param {string|int} key 
 * @returns undefined or the operation looked up
 */
const getOpValue = (sVal) => {
  if( !sVal || !sVal.configOperation || sVal.isHidden ) return;
  const { configOperation } = sVal;
  const ret = ConfigPoint.ConfigPointOperation[configOperation];
  if( !ret ) {
    console.log('configOperation', configOperation,'specified but not defined - might be lazy defined later');
  }
  return ret;
};

/** Creates an object of the same type as src, but as a new copy so that it can be 
 * modified later on.
 * For reference instances, creates a copy of the referenced object.
 * For primitives, returns the primitive.
 * Arrays and objects creates a copy
 * Functions, returns the original function (TBD on how to copy those)
 */
export const mergeCreate = function (sVal, context) {
  if (isPrimitive(sVal)) {
    return sVal;
  }
  const tof = typeof (sVal);
  if (tof === 'function') {
    // TODO - decide between returning raw original and copied/updated value
    return sVal;
  }
  if (tof === 'object') {
    return mergeObject(Array.isArray(sVal) ? [] : {}, sVal, context);
  }
  throw new Error(`The value ${sVal} of type ${tof} isn't a known type for merging.`);
}

const mergeKey = (base,key,context) => key;

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
  let bKey = mergeKey(base, key, context);
  let bVal = base[bKey];
  let sVal = src[key];
  const opValue = getOpValue(sVal);
  
  if( opValue ) {
    if( opValue.immediate ) {
      return opValue.immediate( {sVal, base, bKey, key, context} );
    } else {
      const bKeyHidden = '_'+bKey;
      const bValHidden = base[bKeyHidden] || {...sVal,isHidden: true};
      Object.defineProperty(base,bKey, {
        configurable: true, 
        enumerable: true,
        get: () => {
          const opSrc = base[bKeyHidden];
          if( opSrc.value!==undefined ) return opSrc.value;
          opSrc.value = opValue.getter( {base, bKey, key, context, bKeyHidden} );
          return opSrc.value;
        },
      });
      // Make the background variable hidden by default on the final destination object
      Object.defineProperty(base, bKeyHidden, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: bValHidden,
      });
      if( src.value===undefined ) src.value = undefined;
      bKey = '_'+bKey;
      bVal = base[bKey];
    }
  }

  if (Array.isArray(bVal) && sVal == null) return base;

  if (isPrimitive(bVal)) {
    return base[bKey] = mergeCreate(sVal, context);
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
      Object.defineProperty(this,configName, {
        enumerable: true,
        configurable: true,
        get: () => { return _configPoints[configName]},
      });
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
      if (Array.isArray(configItem)) {
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
    Object.keys(_rootConfigPoints).forEach(key => {
      this.register(_rootConfigPoints);
    });
  },

  // Registers a root config point - one that doesn't get cleared otherwise
  registerRoot(root) {
    Object.assign(_rootConfigPoints, root);
    return ConfigPoint.register(root);
  },
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
