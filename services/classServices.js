const db = require('../models')
const { Class, Student, Teacher } = db
const {
  isOverlapping,
  classLength,
  withinWeek,
  classOrder
} = require('../helpers/date.helper')
const uuidv4 = require('uuid').v4
const baseURL = process.env.ClassLinkURL
const { redisRead } = require('../helpers/redis.helper')
const classServices = {
  getCreatedClasses: (req, cb) => {
    const teacherId = parseInt(req.params.teacherId)
    Class.findAll({ raw: true, where: { teacherId } })
      .then((classes) => {
        if (classes.length < 1) {
          return cb(null, "doesn't have classes data yet")
        }
        const twoWeekClass = classes.filter((aClass) => {
          // 確認是否近兩週內
          return withinWeek(aClass.dateTimeRange, 2) === true
        })
        const result = classOrder(twoWeekClass) // 按照課程先後順序排序

        return cb(null, result)
      })
      .catch((err) => cb(err))
  },
  getCompletedClasses: (req, cb) => {
    const studentId = req.params.studentId
    Class.findAll({
      attributes: ['length', 'dateTimeRange', 'name', 'isCommented', 'teacherId', 'link', 'updatedAt'],
      where: { studentId, isCompleted: true },
      include: { model: Teacher, attributes: ['name', 'avatar'] },
      order: [['updatedAt', 'DESC']]
    })
      .then((classes) => {
        if (classes.length < 1) {
          return cb(null, "doesn't have classes data yet")
        }
        const result = classes.map((aClass) => ({
          ...aClass.toJSON()
        }))
        return cb(null, result)
      })
      .catch((err) => {
        cb(err)
      })
  },
  getTeacherClasses: (req, cb) => {
    const teacherId = req.params.id
    Class.findAll({
      raw: true,
      nest: true,
      attributes: ['length', 'dateTimeRange', 'name', 'link'],
      where: { teacherId, isBooked: true },
      include: { model: Student, attributes: ['name'] }
    })
      .then((classes) => {
        if (classes.length < 1) {
          return cb(null, "doesn't have classes data yet")
        }
        const oneWeekClass = classes.filter((aClass) => {
          // 確認是否近一週內
          return withinWeek(aClass.dateTimeRange, 1) === true
        })
        const result = classOrder(oneWeekClass) // 按照課程先後順序排序
        return cb(null, result)
      })
      .catch((err) => {
        cb(err)
      })
  },
  getStudentClasses: (req, cb) => {
    const studentId = req.params.id
    Class.findAll({
      raw: true,
      nest: true,
      attributes: ['id', 'length', 'dateTimeRange', 'name', 'link'],
      where: { studentId, isBooked: true },
      include: { model: Teacher, attributes: ['name'] }
    })
      .then((classes) => {
        if (classes.length < 1) {
          return cb(null, "doesn't have classes data yet")
        }
        const oneWeekClass = classes.filter((aClass) => {
          // 確認是否近一週內
          return withinWeek(aClass.dateTimeRange, 1) === true
        })
        const result = classOrder(oneWeekClass) // 按照課程先後順序排序

        return cb(null, result)
      })
      .catch((err) => {
        cb(err)
      })
  },
  patchStudentClasses: (req, cb) => {
    const classId = req.params.id
    Class.findByPk(classId)
      .then((aClass) => {
        if (!aClass) {
          const err = new Error("the class doesn't exist")
          err.status = 404
          throw err
        }
        if (req.user.studentId !== aClass.studentId) {
          const err = new Error('permission denied')
          err.status = 401
          throw err
        }
        return aClass.update({ isBooked: false, studentId: null })
      })
      .then((unBookedClass) => cb(null, unBookedClass.toJSON()))
      .catch((err) => {
        cb(err)
      })
  },
  patchClasses: (req, cb) => {
    const teacherId = parseInt(req.params.teacherId)
    const studentId = parseInt(req.user.studentId)
    const { dateTimeRange } = req.body

    // 不是學生不能預訂課程,老師不能預訂自己的課
    if (!studentId || req.user.teacherId === teacherId) {
      const err = new Error('permission denied')
      err.status = 401
      throw err
    }
    Class.findOne({ where: { teacherId, dateTimeRange } })
      .then((aClass) => {
        if (!aClass) {
          const err = new Error("the class doesn't exist")
          err.status = 404
          throw err
        }
        if (aClass.isBooked) {
          const err = new Error('This class is booked!')
          err.status = 400
          throw err
        }
        return aClass.update({ isBooked: true, studentId })
      })
      .then((aClass) => cb(null, aClass))
      .catch((err) => cb(err))
  },
  postClass: (req, res, cb) => {
    const { name, dateTimeRange } = req.body
    const { studentId, teacherId } = req.user
    const categoryId = parseInt(req.body.category)

    if (!teacherId) {
      // 若不是老師，不能新增課程
      const err = new Error('permission denied')
      err.status = 401
      throw err
    }
    if (!(dateTimeRange && name)) {
      // 兩個都要存在才能新增課程
      const err = new Error('Date and name are required')
      err.status = 400
      throw err
    }

    // 使用async 確保先確認 if studentId
    async function postClass () {
      // 確認老師開課時間是否與自己是學生身份的預定課程有衝突
      if (studentId) {
        await Class.findAll({ raw: true, where: { studentId } })
          .then((classes) => {
            if (classes.length > 0) {
              const overlap = classes.some((aClass) => {
                return isOverlapping(aClass.dateTimeRange, dateTimeRange)
              })
              if (overlap) {
                const err = new Error(
                  'This class conflicts with other class you booked as student'
                )
                err.status = 400
                throw err
              }
            }
          })
          .catch((err) => cb(err))
      }
      // 若上述沒衝突，則確認身為老師是否自己已在此時段開課
      if (res.statusCode !== 400) {
        await Class.findAll({ raw: true, where: { teacherId } })
          .then((classes) => {
            if (classes.length > 0) {
              const overlap = classes.some((aClass) => {
                return isOverlapping(aClass.dateTimeRange, dateTimeRange)
              })
              if (overlap) {
                const err = new Error(
                  'This class conflicts with other class you create as teacher'
                )
                err.status = 400
                throw err
              }
            }
            const length = classLength(dateTimeRange)

            return Class.create({
              name,
              dateTimeRange,
              link: baseURL + uuidv4().slice(0, 8),
              length,
              categoryId,
              teacherId
            })
          })
          .then((aClass) => {
            cb(null, aClass.toJSON())
          })
          .catch((err) => cb(err))
      }
    }
    postClass()
  },
  putClass: (req, cb) => {
    const { name, dateTimeRange } = req.body
    const teacherId = req.user.teacherId
    const categoryId = parseInt(req.body.category)
    const classId = req.params.id
    if (!teacherId) {
      // 若不是老師，不能修改課程
      const err = new Error('permission denied')
      err.status = 401
      throw err
    }
    if (!(dateTimeRange && name)) {
      // 三個都要存在才能新增課程
      const err = new Error('Date and name are required')
      err.status = 400
      throw err
    }
    Class.findByPk(classId)
      .then((aClass) => {
        if (!aClass) {
          const err = new Error("Class didn't exist!")
          err.status = 404
          throw err
        }
        const length = classLength(dateTimeRange)

        return aClass.update({
          name,
          dateTimeRange,
          length,
          categoryId
        })
      })
      .then((aClass) => {
        cb(null, aClass)
      })
      .catch((err) => cb(err))
  },
  deleteClass: (req, cb) => {
    const id = req.params.id
    if (!req.user.teacherId) {
      const err = new Error('permission denied')
      err.status = 401
      throw err
    }
    Class.findByPk(id)
      .then((aClass) => {
        if (!aClass) {
          const err = new Error("Class didn't exist!")
          err.status = 404
          throw err
        }
        if (aClass.isCompleted) {
          const err = new Error("You can't delete a completed class")
          err.status = 400
          throw err
        }
        return aClass.destroy()
      })
      .then((deletedClass) => cb(null, deletedClass))
      .catch((err) => cb(err))
  },
  getHistory: (req, cb) => {
    const { email } = req.user
    const roomName = req.params.roomName

    // const redis = async (roomName) => {
    //   const client = createClient({
    //     // url: `redis://${process.env.REDIS_IP}:${process.env.REDIS_PORT}` // for docker
    //     url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` // for Zeabur
    //   })
    //   client.on('ready', () => {
    //     console.log('Redis is ready when take data')
    //   })
    //   client.on('error', (err) => {
    //     console.log("Redis' error when take data", err)
    //   })
    //   await client.connect()
    //   console.log('roomName', roomName)
    //   const chat = await client.lRange(`chat:${roomName}`, 0, -1)
    //   console.log('抓到redis 回傳chat', chat)

    //   await client.quit()
    //   return chat
    // }

    const getData = async (roomName, email) => {
      try {
        const chat = await redisRead(roomName)
        if (chat.length < 1) {
          return cb(null, "doesn't have chat history")
        }
        // const err = new Error('permission denied')
        // err.status = 401
        // 確認歷史對話裡的email有user的email
        // chat.some((message) => JSON.parse(message).email === email)
        //   ? cb(null, chat)
        //   : cb(err)
        cb(null, chat)
      } catch (err) {
        cb(err)
      }
    }
    getData(roomName, email)
  }
}

module.exports = classServices
