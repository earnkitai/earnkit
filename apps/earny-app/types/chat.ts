import { Message } from './message';
import { User } from './user';

export interface Chat {
  id: string;
  userId: string;
  title?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: User;
  messages: Message[];
}
