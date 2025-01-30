declare namespace Express {
  export interface Request {
    user?: {
      address: string;
    };
  }
}
