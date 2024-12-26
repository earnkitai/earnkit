import mongoose, { Schema, Document } from 'mongoose';
import { IUser } from '../types';
import crypto from 'crypto';

export interface IUserDocument extends IUser, Document {}

const UserSchema: Schema = new Schema({
  userId: { 
    type: String, 
    required: true, 
    unique: true,
    default: () => crypto.randomUUID()
  },
  email: { 
    type: String, 
    required: true, 
    unique: true 
  },
  apiKey: { 
    type: String, 
    required: true, 
    unique: true,
    default: () => crypto.randomBytes(32).toString('hex')
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

export default mongoose.model<IUserDocument>('User', UserSchema);
