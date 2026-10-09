import mongoose from 'mongoose'
import { env } from './env.js'

mongoose.set('strictQuery', true)

export async function connectDb() {
  await mongoose.connect(env.mongoUrl, { serverSelectionTimeoutMS: 8000 })
  return mongoose.connection
}
