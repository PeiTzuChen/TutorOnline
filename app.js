if ((process.env.NODE_ENV === 'development')) require('dotenv').config()
const express = require('express')
const app = express()
const port = process.env.PORT || 3000
const route = require('./routes')
const passport = require('./config/passport')
const { deleteFiles } = require('./helpers/file.helper')
// cross-origin
app.use((req, res, next) => {
  res.setHeader(
    'Access-Control-Allow-Origin',
    'https://tutoring-platform-becky.vercel.app'
  )
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, PATCH')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, authorization, accept, accept-encoding'
  )
  next()
})

app.use(express.json())
app.use(passport.initialize())
setInterval(deleteFiles, 3600000) // 每一小時刪除暫存temp資料
app.use(route)

app.listen(port, () =>
  console.log(`app listening on http://localhost:${port}`)
)
