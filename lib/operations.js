var _ = require('lodash')
var http = require('http')

module.exports = function (model, filter, options, query) {
  var contextFilter
  var postCreate
  var postUpdate
  var postDelete
  var outputFn

  function outputExpress (req, res, data) {
    if (data.result !== null) {
      res.status(data.statusCode || 200).json(data.result)
    } else {
      res.status(data.statusCode || 200).end()
    }
  }

  function outputRestify (req, res, data) {
    if (data.result !== null) {
      res.send(data.statusCode || 200, data.result)
    } else {
      res.send(data.statusCode || 200)
    }
  }

  if (options.contextFilter) {
    contextFilter = options.contextFilter
  } else {
    contextFilter = function (model, req, done) {
      done(model)
    }
  }

  if (options.postCreate) {
    postCreate = options.postCreate
  } else {
    postCreate = function (res, result, done) {
      done()
    }
  }

  if (options.postUpdate) {
    postUpdate = options.postUpdate
  } else {
    postUpdate = function (res, result, done) {
      done()
    }
  }

  if (options.postDelete) {
    postDelete = options.postDelete
  } else {
    postDelete = function (res, result, done) {
      done()
    }
  }

  outputFn = options.outputFn ? options.outputFn : (options.restify ? outputRestify : outputExpress)

  function findById (filteredContext, id) {
    var byId = {}
    byId[options.idProperty] = id
    return filteredContext.findOne().and(byId)
  }

  function getItems (req, res, next) {
    contextFilter(model, req, function (filteredContext) {
      query.build(filteredContext.find(), req).lean(options.lean).exec(function (err, items) {
        if (err) {
          err.statusCode = 400
          return next(err)
        }

        var populate = query.current.populate
        var opts = {
          populate: populate,
          access: req.access
        }

        try {
          items = filter.filterObject(items, opts)

          outputFn(req, res, {
            result: items,
            statusCode: 200
          })
          next()
        } catch(e) {
          e.statusCode = 400
          return next(err)
        }
      })
    })
  }

  function getCount (req, res, next) {
    contextFilter(model, req, function (filteredContext) {
      query.build(filteredContext.count(), req).exec(function (err, count) {
        if (err) {
          err.statusCode = 400
          return next(err)
        }

        outputFn(req, res, {
          result: { count: count },
          statusCode: 200
        })
        next()
      })
    })
  }

  function getShallow (req, res, next) {
    contextFilter(model, req, function (filteredContext) {
      query.build(findById(filteredContext, req.params.id), req).lean(options.lean).exec(function (err, item) {
        if (err) {
          err.statusCode = 400
          return next(err)
        }

        if (!item) {
          err = new Error(http.STATUS_CODES[404])
          err.statusCode = 404
          return next(err)
        }

        var populate = query.current.populate
        var opts = {
          populate: populate,
          access: req.access
        }

        try {
          item = filter.filterObject(item, opts)

          for (var prop in item) {
            item[prop] = typeof item[prop] === 'object' && prop !== '_id' ?
              true : item[prop]
          }

          outputFn(req, res, {
            result: item,
            statusCode: 200
          })
          next()
        } catch(e) {
          e.statusCode = 400
          return next(e)
        }
      })
    })
  }

  function deleteItems (req, res, next) {
    contextFilter(model, req, function (filteredContext) {
      query.build(filteredContext.find(), req).remove(function (err, items) {
        if (err) {
          err.statusCode = 400
          return next(err)
        }

        outputFn(req, res, {
          statusCode: 204
        })
        next()
      })
    })
  }

  function getItem (req, res, next) {
    contextFilter(model, req, function (filteredContext) {
      query.build(findById(filteredContext, req.params.id), req).lean(options.lean).exec(function (err, item) {
        if (err) {
          err.statusCode = 400
          return next(err)
        }

        if (!item) {
          err = new Error(http.STATUS_CODES[404])
          err.statusCode = 404
          return next(err)
        }

        var populate = query.current.populate
        var opts = {
          populate: populate,
          access: req.access
        }

        try {
          item = filter.filterObject(item, opts)

          outputFn(req, res, {
            result: item,
            statusCode: item ? 200 : 404
          })
          next()
        } catch(e) {
          e.statusCode = 400
          return next(e)
        }
      })
    })
  }

  function deleteItem (req, res, next) {
    var byId = {}
    byId[options.idProperty] = req.params.id

    if (options.findOneAndRemove) {
      contextFilter(model, req, function (filteredContext) {
        findById(filteredContext, req.params.id).findOneAndRemove(function (err, result) {
          if (err) {
            err.statusCode = 400
            return next(err)
          }

          if (!result) {
            err = new Error(http.STATUS_CODES[404])
            err.statusCode = 404
            return next(err)
          }

          postDelete(res, result, function (err) {
            if (err) {
              err.statusCode = err.statusCode || 400
              return next(err)
            }

            outputFn(req, res, {
              statusCode: 204
            })
            next()
          })
        })
      })
    } else {
      contextFilter(model, req, function (filteredContext) {
        findById(filteredContext, req.params.id).exec(function (err, doc) {
          if (err) {
            err.statusCode = 400
            return next(err)
          }

          if (!doc) {
            err = new Error(http.STATUS_CODES[404])
            err.statusCode = 404
            return next(err)
          }

          doc.remove(function (err, result) {
            if (err) {
              err.statusCode = err.statusCode || 400
              return next(err)
            }

            postDelete(res, doc, function (err) {
              if (err) {
                err.statusCode = err.statusCode || 400
                return next(err)
              }

              outputFn(req, res, {
                statusCode: 204
              })
              next()
            })
          })
        })
      })
    }
  }

  function createSingleObject (body) {
    for (var key in body) {
      var path = model.schema.path(key)

      if (typeof path === 'undefined') {
        continue
      }

      if (path.caster !== undefined) {
        if (path.caster.instance === 'ObjectID') {
          if (_.isArray(body[key])) {
            for (var k = 0; k < body[key].length; ++k) {
              if (typeof body[key][k] === 'object') {
                body[key][k] = body[key][k]._id
              }
            }
          } else if ((typeof body[key] === 'object') && (body[key] !== null)) {
            body[key] = body[key]._id
          }
        }
      } else if ((path.instance === 'ObjectID') && (typeof body[key] === 'object') && (body[key] !== null)) {
        body[key] = body[key]._id
      }
    }
  }

  function createObject (req, res, next) {
    var filterOpts = {
      access: req.access
    }

    req.body = filter.filterObject(req.body || {}, filterOpts)

    if (model.schema.options._id) {
      delete req.body._id
    }

    if (model.schema.options.versionKey) {
      delete req.body[model.schema.options.versionKey]
    }

    if (_.isArray(req.body)) {
      for (var i = 0; i < req.body.length; ++i) {
        createSingleObject(req.body[i])
      }
    } else {
      createSingleObject(req.body)
    }

    model.create(req.body, function (err, item) {
      if (err) {
        err.statusCode = 400
        return next(err)
      }

      var result = filter.filterObject(item, filterOpts)

      postCreate(res, result, function (err) {
        if (err) {
          err.statusCode = err.statusCode || 400
          return next(err)
        }

        outputFn(req, res, {
          result: result,
          statusCode: 201
        })
        next()
      })
    })
  }

  function modifyObject (req, res, next) {
    var filterOpts = {
      access: req.access
    }

    req.body = filter.filterObject(req.body || {}, filterOpts)
    delete req.body._id

    if (model.schema.options.versionKey) {
      delete req.body[model.schema.options.versionKey]
    }

    for (var key in req.body) {
      var path = model.schema.path(key)

      if (typeof path === 'undefined') {
        continue
      }

      if (path.caster !== undefined) {
        if (path.caster.instance === 'ObjectID') {
          if (_.isArray(req.body[key])) {
            for (var j = 0; j < req.body[key].length; ++j) {
              if (typeof req.body[key][j] === 'object') {
                req.body[key][j] = req.body[key][j]._id
              }
            }
          } else if ((typeof req.body[key] === 'object') && (req.body[key] !== null)) {
            req.body[key] = req.body[key]._id
          }
        }
      } else if ((path.instance === 'ObjectID') && (typeof req.body[key] === 'object') && (req.body[key] !== null)) {
        req.body[key] = req.body[key]._id
      }
    }

    if (options.findOneAndUpdate) {
      contextFilter(model, req, function (filteredContext) {
        findById(filteredContext, req.params.id).findOneAndUpdate({}, req.body, {
          new: true,
          runValidators: options.runValidators
        }, function (err, item) {
          if (err) {
            err.statusCode = 400
            return next(err)
          }

          if (!item) {
            err = new Error(http.STATUS_CODES[404])
            err.statusCode = 404
            return next(err)
          }

          item = filter.filterObject(item, filterOpts)

          postUpdate(res, item, function (err) {
            if (err) {
              err.statusCode = err.statusCode || 400
              return next(err)
            }

            outputFn(req, res, {
              result: item,
              statusCode: 200
            })
            next()
          })
        })
      })
    } else {
      contextFilter(model, req, function (filteredContext) {
        findById(filteredContext, req.params.id).exec(function (err, doc) {
          if (err) {
            err.statusCode = 400
            return next(err)
          }

          if (!doc) {
            err = new Error(http.STATUS_CODES[404])
            err.statusCode = 404
            return next(err)
          }

          for (var key in req.body) {
            doc.set(key, req.body[key])
          }

          doc.save(function (err, item) {
            if (err) {
              err.statusCode = 400
              return next(err)
            }

            item = filter.filterObject(item, filterOpts)

            postUpdate(res, item, function (err) {
              if (err) {
                err.statusCode = err.statusCode || 400
                return next(err)
              }

              outputFn(req, res, {
                result: item,
                statusCode: 200
              })
              next()
            })
          })
        })
      })
    }
  }

  return {
    getItems: getItems,
    getCount: getCount,
    getItem: getItem,
    getShallow: getShallow,
    createObject: createObject,
    modifyObject: modifyObject,
    deleteItems: deleteItems,
    deleteItem: deleteItem
  }
}