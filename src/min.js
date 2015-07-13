import utils from './utils.js'
import { EventEmitter, Promise } from './deps/events.js'
import mix from './mix.js'
import hash from './hash.js'
import list from './list.js'
import set from './set.js'
import zset from './zset.js'
import mise from './mise.js'
import { memStore, localStore } from './stores.js'

var self = this || window || global

var noop = utils.noop

var min = {}
export default min

utils.extend(min, EventEmitter.prototype)
min.EventEmitter = EventEmitter
min.Promise = Promise

min.memStore = memStore
min.localStore = localStore

min.store = new localStore()

var _keys = min._keys = {}
var _keysTimer = null
var _types = {
  0 : 'mix',
  1 : 'hash',
  2 : 'list',
  3 : 'set',
  4 : 'zset'  // Sorted Set
}

/**
 * Fork a new MinDB object
 * @return {Object} new min object
 */
min.fork = () => {
  var rtn = {}
  var self = this

  for (var prop in this) {
    if (this.hasOwnProperty(prop)) {
      rtn[prop] = this[prop]
    }
  }

  return rtn
}


/*********
** Keys **
*********/

/**
 * Delete a key
 * @param  {String}   key      Key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.del = function(key, callback = noop) {
  // Promise Object
  var promise = new Promise(noop)

  promise.then(() => {
    this.emit('del', key)
    if (_keysTimer) {
      clearTimeout(_keysTimer)
    }

    _keysTimer = setTimeout(this.save.bind(this), 1000)
  })

  // Store
  var store = this.store

  // Key prefix
  var $key = 'min-' + key

  if (store.async) {
    // Async Store Operating
    
    var load = () => {
      // Value processing
      store.remove($key, err => {
        if (err) {
          // Error!
          promise.reject(err)
          return callback(err)
        }

        delete this._keys[key]

        // Done
        promise.resolve(key)
        callback(null, key)
      })
    }

    if (store.ready) {
      load()
    } else {
      store.on('ready', load)
    }
  } else {
    try {
      store.remove($key)

      delete this._keys[key]

      // Done
      promise.resolve(key)
      callback(null, key)
    } catch(err) {
      // Error!
      promise.reject(err)
      callback(err)
    }
  }

  // Event emitting
  this.emit('del', key)

  return promise
}

/**
 * Check a key is exists or not
 * @param  {String}   key      Key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.exists = function(key, callback = noop) {
  // Promise Object
  var promise = new Promise(noop)

  try {
    this.get(key)
      .then(value => {
        if ('undefined' == typeof value) {
          promise.resolve(false)
          return callback(null, false)
        } else {
          promise.resolve(true)
          return callback(null, true)
        }
      }, err => {
        promise.resolve(false)
        callback(null, false)
      })
  } catch(err) {
    promise.reject(err)
    return callback(err)
  }

  return promise
}

/**
 * Rename a old key
 * @param  {String}   key      the old key
 * @param  {String}   newKey   the new key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.renamenx = function(key, newKey, callback = noop) {
  // Promise object
  var promise = new Promise(noop)

  promise.then(_ => {
    this.emit('rename', key, newKey)
    if (_keysTimer) {
      clearTimeout(_keysTimer)
    }

    _keysTimer = setTimeout(this.save.bind(this), 5 * 1000)
  })

  try {
    // Error handle
    var reject = err => {
      promise.reject(err)
      callback(err)
    }

    var type = null
    var value = null

    this.exists(key)
      .then(exists => {
        if (!exists) {
          var err = new Error('no such key')

          reject(err)
        } else {
          return this.get(key)
        }
      })
      .then(_value => {
        type = this._keys[key]
        value = _value

        return this.del(key)
      })
      .then(_ => {
        return this.set(newKey, value, callback)
      })
      .then(
        _ => {
          this._keys[newKey] = type
          promise.resolve('OK')
          callback(null, 'OK')
        },
        reject
      )

  } catch(err) {
    reject(err)
  }

  return promise
}

/**
 * Rename a old key when the old key is not equal to the new key
 * and the old key is exiest.
 * @param  {String}   key      the old key
 * @param  {String}   newKey   the new key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.rename = function(key, newKey, callback = noop) {
  // Promise object
  var promise = new Promise(noop)

  promise.then(_ => {
    this.emit('rename', key, newKey)
    if (_keysTimer) {
      clearTimeout(_keysTimer)
    }

    _keysTimer = setTimeout(this.save.bind(this), 5 * 1000)
  })

  // Error handle
  var reject = err => {
    promise.reject(err)
    callback(err)
  }

  if (key == newKey) {
    // The origin key is equal to the new key
    reject(new Error('The key is equal to the new key.'))
  } else {
    this.renamenx.apply(this, arguments)
      .then(
        promise.resolve.bind(promise),
        promise.reject.bind(promise)
      )
  }
  return promise
}

/**
 * Return the keys which match by the pattern
 * @param  {String}   pattern  Pattern
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.keys = function(pattern, callback = noop) {

  // Promise object
  var promise = new Promise()

  // Stored keys
  var keys = Object.keys(this._keys)

  // Filter
  var filter = pattern
    .replace('?', '(.)')
    .replace('*', '(.*)')
  filter = new RegExp(filter)

  var ret = []

  for (var i = 0; i < keys.length; i++) {
    if (keys[i].match(filter)) {
      ret.push(keys[i])
    }
  }

  // Done
  setTimeout(_ => promise.resolve(ret), 100)
  callback(null, ret)

  return promise
}

/**
 * Return a key randomly
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.randomkey = function(callback = noop) {
  
  // Promise Object
  var promise = new Promise(noop)

  // Stored keys
  var keys = Object.keys(this._keys)

  // Random Key
  var index = Math.round(Math.random() * (keys.length - 1))

  // Done
  var $key = keys[index]
  promise.resolve($key)
  callback(null, $key)

  return promise
}

/**
 * Return the value's type of the key
 * @param  {String}   key      the key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.type = function(key, callback = noop) {

  // Promise Object
  var promise = new Promise(noop)

  if (this._keys.hasOwnProperty(key)) {
    promise.resolve(_types[this._keys[key]])
    callback(null, callback)
  } else {
    promise.resolve(null)
    callback(null, null)
  }

  return promise
}

/**
 * Remove all keys in the db
 * @param  {Function} callback Callback
 * @return {Object}            min
 */
min.empty = function(callback = noop) {
  var promise = new Promise(noop)
  var keys = Object.keys(this._keys)
  var last = null
  var loop = null
  var removeds = 0

  promise.then(len => {
    this.emit('empty', len)
    if (_keysTimer) {
      clearTimeout(_keysTimer)
    }

    _keysTimer = setTimeout(this.save.bind(this), 5 * 1000)
  })

  (loop = key => {
    if (key) {
      this.del(key, err => {
        if (!err) {
          removeds++
        }

        loop(keys.shift())
      })
    } else {
      promise.resolve(removeds)
      callback(null, removeds)
    }
  })(keys.shift())

  return promise
}

/**
 * Save the dataset to the Store Interface manually
 * @param  {Function} callback callback
 * @return {Promise}           promise
 */
min.save = function(callback = noop) {
  var promise = new Promise(noop)

  promise.then(([dump, strResult]) => {
    this.emit('save', dump, strResult)
  })

  this.set('min_keys', JSON.stringify(this._keys))
    .then(_ => this.dump())
    .then(
      (dump, strResult) => {
        promise.resolve([dump, strResult])
        callback(dump, strResult)
      },
      err => {
        promise.reject(err)
        callback(err)
      }
    )

  return promise
}

/**
 * Return the dataset of MinDB
 * @param  {Function} callback callback
 * @return {Promise}           promise
 */
min.dump = function(callback = noop) {
  var loop = null
  var promise = new Promise()

  var rtn = {}

  this.keys('*', (err, keys) => {
    if (err) {
      promise.reject(err)
      return callback(err)
    }

    (loop = key => {
      if (key) {
        this.get(key)
          .then(value => {
            rtn[key] = value
            loop(keys.shift())
          }, err => {
            promise.reject(err)
            callback(err)
          })
      } else {
        var strResult = JSON.stringify(rtn)
        promise.resolve([rtn, strResult])
        callback(null, rtn, strResult)
      }
    })(keys.shift())
  })

  return promise
}

/**
 * Restore the dataset to MinDB
 * @param  {Object}   dump     dump object
 * @param  {Function} callback callback
 * @return {Promise}           promise
 */
min.restore = function(dump, callback = noop) {
  var promise = new Promise(noop)
  var loop = null

  promise.then(_ => {
    this.save(_ => {
      this.emit('restore')
    })
  })

  var keys = Object.keys(dump)

  (loop = (key, done) => {
    if (key) {
      this.set(key, dump[key])
        .then(
          _ => {
            loop(keys.shift(), done)
          },
          err => {
            promise.reject(err)
            callback(err)
          }
        )
    } else {
      done()
    }
  })(keys.shift(), _ => {
    this
      .exists('min_keys')
      .then(exists => {
        if (exists) {
          return this.get('min_keys')
        } else {
          promise.resolve()
          callback()
        }
      })
      .then(keys => {
        _keys = JSON.parse(keys)

        promise.resolve()
        callback()
      })
  })

  return promise
}

var watchers = {}

/**
 * Watch the command actions of the key
 * @param  {String}   key      key to watch
 * @param  {String}   command  command to watch
 * @param  {Function} callback callback
 * @return {Promise}           promise
 */
min.watch = function(key, callback, command = 'set') {
  var watcherId = Math.random().toString(32).substr(2)

  if (!watchers[key]) watchers[key] = {}

  watchers[key][watcherId] = (_key, ...args) => {
    if (_key !== key) return
    callback.call(this, ...args)
  }

  watchers[key][watcherId].command = command

  this.on(command, watchers[key][watcherId])

  return watcherId
}

/**
 * Unbind the watcher
 * @param  {String} key       key to unwatch
 * @param  {String} watcherId watcher's id
 * @param  {String} command   command
 */
min.unwatch = function(key, watcherId, command = 'set') {
  this.removeListener(command, watchers[key][watcherId])
}

/**
 * Unbind all the watcher of the key
 * @param  {String} key key to unwatch
 */
min.unwatchForKey = function(key) {
  var watchersList = watchers[key]

  for (var id in watchersList) {
    var watcher = watchersList[id]
    this.removeListener(watcher.command, watcher)
  }
}


// Methods
utils.extend(min, hash)
utils.extend(min, list)
utils.extend(min, set)
utils.extend(min, zset)
utils.extend(min, mise)
utils.extend(min, mix)

// Apply
min.exists('min_keys')
  .then(exists => {
    if (exists)
      return min.get('min_keys')
  })
  .then(keys => {
    min._keys = JSON.parse(keys)
  })