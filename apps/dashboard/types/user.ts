import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryColumn({ name: 'turnkey_user_id' })
  turnkeyUserId!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ name: 'turnkey_organization_id' })
  turnkeyOrganizationId!: string;

  @Column({ name: 'wallet_address' })
  walletAddress!: string;

  @Column({ name: 'is_verified', default: false })
  isVerified!: boolean;

  @Column({ name: 'is_active', default: false })
  isActive!: boolean;

  @Column({ name: 'has_passkey', default: false })
  hasPasskey!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
