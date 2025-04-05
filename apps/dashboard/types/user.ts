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

  @Column({ name: 'recovery_address', nullable: true })
  recoveryAddress?: string;

  @Column({ name: 'recovery_signature', nullable: true })
  recoverySignature?: string;

  @Column({ name: 'is_verified', default: false })
  isVerified!: boolean;

  @Column({ name: 'is_active', default: false })
  isActive!: boolean;

  @Column({ name: 'has_passkey', default: false })
  hasPasskey!: boolean;

  @Column({ name: 'turnkey_embedded_key', nullable: true })
  turnkeyEmbeddedKey?: string;

  @Column({ name: 'farcaster_fid', nullable: true })
  farcasterFid?: string;

  @Column({ name: 'farcaster_display_name', nullable: true })
  farcasterDisplayName?: string;

  @Column({ name: 'farcaster_custody_address', nullable: true })
  farcasterCustodyAddress?: string;

  @Column({ name: 'farcaster_profile_url', nullable: true })
  farcasterProfilePictureUrl?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
