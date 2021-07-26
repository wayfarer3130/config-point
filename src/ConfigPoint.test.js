import { ConfigPoint, InsertOp, DeleteOp, ReferenceOp, SortOp } from './index.js';
// Import for testing internals
import { mergeCreate, mergeObject } from './ConfigPoint.js';

describe('ConfigPoint.js', () => {
  const CONFIG_NAME = 'testConfigPoint';
  const BASE_CONFIG = {
    a: '1',
    list: [1, 2, 3],
    obj: { v1: 'v1', v2: 'v2' },
    obj2: { v1: 'v1', v2: 'v2' },
    sumFunc: (a, b) => a + b,
  };

  const MODIFY_NAME = "modify";
  const MODIFY_CONFIG = {
    name: MODIFY_NAME,
    a: '2',
    // Default operation is to merge/replace item by item
    list: ["one", "two", "three", "four"],
    // Default object behaviour is update
    obj: { v2: 'v2New', v3: 'v3' },
    // Over-ride operation to replace entire item
    obj2: { v2: 'v2New', v3: 'v3', ...ConfigPoint.REPLACE },
    // Default function behaviour is replace, which in this case means add new.
    subFunc: (a, b) => a - b,
  };

  const MODIFY_MATCH = {
    a: '2',
    // list: [1.5,'two',3],
    // Default object behaviour is update
    // obj: { v1: 'v1', v2: 'v2New', v3: 'v3' },
    // Over-ride operation to replace entire item
    // obj2: { v2: 'v2New', v3: 'v3' },
    // Default function behaviour is replace, which in this case means add new.
    subFunc: MODIFY_CONFIG.subFunc,
  };


  beforeEach(() => {
    ConfigPoint.clear();
    jest.clearAllMocks();
  });

  describe('mergeCreate()', () => {
    it('creates primitives', () => {
      const aNumber = mergeCreate(123);
      expect(aNumber).toBe(123);
      const aString = mergeCreate('str');
      expect(aString).toBe('str');
      const aBool = mergeCreate(false);
      expect(aBool).toBe(false);
      const aNull = mergeCreate(null);
      expect(aNull).toBe(null);
    });

    it('Copies functions', () => {
      const sumFunc = (a, b) => a + b;
      sumFunc.value = 5;
      sumFunc.obj = { nested: true };
      const copyFunc = mergeCreate(sumFunc);
      expect(typeof (copyFunc)).toBe('function');
      expect(copyFunc.obj).toEqual(sumFunc.obj);
      expect(copyFunc.value).toEqual(sumFunc.value);
    });

    it('Copies arrays', () => {
      const arr = [1, 2, 3];
      const created = mergeCreate(arr);
      expect(created).toEqual(arr);
    });

    it('copies objects', () => {
      const aCopy = mergeCreate(BASE_CONFIG);
      expect(aCopy.a).toBe('1');
      expect(aCopy.list).toEqual([1, 2, 3]);
      expect(aCopy.sumFunc(5, 6)).toBe(11);
    });


  });

  describe('addConfig()', () => {
    it('Adds an extension level', () => {
      const config = ConfigPoint.addConfig(CONFIG_NAME, BASE_CONFIG);
      expect(config).toMatchObject(BASE_CONFIG);
    });
  });

  describe('extendConfig()', () => {
    it('updates the config data', () => {
      const level = ConfigPoint.addConfig(CONFIG_NAME, BASE_CONFIG);
      level.extendConfig(MODIFY_CONFIG);
      expect(level).toMatchObject(MODIFY_MATCH);
    });
  });

  describe('hasConfig()', () => {
    ConfigPoint.register({
        configName: CONFIG_NAME,
        configBase: BASE_CONFIG,
    });
    expect(ConfigPoint.hasConfig(CONFIG_NAME)).toBe(true);
    expect(ConfigPoint.hasConfig('notFound')).toBe(false);    
  });
  
  describe('register()', () => {
    it('creates a base configuration', () => {
      const { testConfigPoint } = ConfigPoint.register({
        configName: CONFIG_NAME,
        configBase: BASE_CONFIG,
      });
      expect(testConfigPoint).toMatchObject(BASE_CONFIG);
    });

    it('creates and updates', () => {
      const { testConfigPoint } = ConfigPoint.register({
        configName: CONFIG_NAME,
        configBase: BASE_CONFIG,
        extension: MODIFY_CONFIG,
      });
      expect(testConfigPoint).toMatchObject(MODIFY_MATCH);
    });

    it('references context value', () => {
      const _multiply = (a, b) => a * b;
      const registered = ConfigPoint.register([{
        configName: CONFIG_NAME,
        configBase: {
          _multiply,
          multiply: { configOperation: 'reference', reference: '_multiply' },
        },
        extension: MODIFY_CONFIG,
      }]);
      const { testConfigPoint } = registered;
      expect(testConfigPoint.multiply).toBe(_multiply);
    });

    it('extends first, then creates base', () => {
      const { testConfigPoint } = ConfigPoint.register({
        configName: CONFIG_NAME,
        extension: MODIFY_CONFIG,
      }, 
      {
        configName: CONFIG_NAME,
        configBase: BASE_CONFIG,
      });
      expect(testConfigPoint).toMatchObject(MODIFY_MATCH);

    });

    it('extends named base', () => {
      const { testConfigPoint2 } = ConfigPoint.register({
        configName: CONFIG_NAME,
        configBase: BASE_CONFIG,
        extension: MODIFY_CONFIG,
      }, 
      {
        configName: CONFIG_NAME+'2',
        configBase: CONFIG_NAME,
      });
      expect(testConfigPoint2).toMatchObject(MODIFY_MATCH);

    });

    it('Throws on extend of same instance', () => {
      expect( () => {
        ConfigPoint.register({
          configName: CONFIG_NAME,
          configBase: CONFIG_NAME,
        });
      }).toThrow();
    });

    it('Throws on extend twice', () => {
      expect( () => ConfigPoint.register({
          configName: CONFIG_NAME,
          extension: {name:'name',},
        },
        {
          configName: CONFIG_NAME,
          extension: {name:'name',},
        })).toThrow();
    });

  });
  
  describe('configOperation()', () => {
    it('DeleteOp', () => {
      const { testConfigPoint } = ConfigPoint.register({
        configName: CONFIG_NAME,
        configBase: {
          toBeDeleted: true,
          list: [0,1,2,3],
        },
        extension: {
          toBeDeleted: DeleteOp.create(1),
          list: [DeleteOp.at(1)],
        },
      });
      expect(testConfigPoint.toBeDeleted).toBe(undefined);
      expect(testConfigPoint.list).toMatchObject([0,2,3]);
    });

    it('ReferenceOp', () => {
      const nonReference = {reference:'preExistingItem', };
      const { testConfigPoint } = ConfigPoint.register({
        configName: CONFIG_NAME,
        configBase: {
          preExistingItem: 'item',
          reference: ReferenceOp.createCurrent('preExistingItem'),
        },
        extension: {
          reference2: {configOperation: 'reference', reference: 'reference'},
          nonReference,
        },
      });
      expect(testConfigPoint.reference).toBe('item');
      expect(testConfigPoint.reference2).toBe('item');
      expect(testConfigPoint.nonReference).toMatchObject(nonReference);
    });

    it('InsertOp', () => {
      const arr = [1, 2, 3];
      const base = { arr };
      const inserts = { arr: [InsertOp.at(1, 1.5)] };
      let created = mergeCreate(base);
      mergeObject(created, inserts);
      expect(created.arr).toEqual([1, 1.5, 2, 3]);
    });

    it('SortOp', () => {
      const srcPrimitive = [3, 1, 2];
      const srcArray = [{value: 3, priority: 1}, {value:2, priority: 2}, {value:1, priority:3}];
      const srcObject = {three:{value: 3, priority: 1}, two:{value:2, priority: 2}, one:{value:1, priority:3}};
      const configBase = { 
        srcPrimitive, srcArray, srcObject,
        sortPrimitive: SortOp.createSort('srcPrimitive'),
        sortArray: SortOp.createSort('srcArray', 'priority', 'value'),
        sortObject: SortOp.createSort('srcObject', 'priority'),
        sortMissing: SortOp.createSort('srcMissing', 'priority'),
      };
      const { testConfigPoint } = ConfigPoint.register({
        configName: CONFIG_NAME,
        configBase,
      });
      expect(testConfigPoint.sortPrimitive).toMatchObject([1,2,3]);
      expect(testConfigPoint.sortArray).toMatchObject([3,2,1]);
      expect(testConfigPoint.sortObject).toMatchObject([srcObject.three, srcObject.two, srcObject.one]);
      expect(testConfigPoint.sortMissing).toMatchObject([]);
    });

  });


});
