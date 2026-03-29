import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    ButtonInteraction, 
    ModalSubmitInteraction 
} from 'discord.js';
import { HiveProxyInteraction } from '../core/HiveUX.js';
import { Logger } from '../core/Logger.js';

/**
 * PILLAR MODEL: UserProfile
 */
export interface UserProfile {
    uid: string;
    discordId: string;
    discordTag?: string;
    photoURL?: string | null;
    zaps: number;
    joinedAt: any; // Firestore Timestamp
    lastActive: any; // Firestore Timestamp
    lastTransactionTime?: any;
    claimStreak?: number;
    lastFreeClaimAt?: any;
    abuseStrikes?: number;
    lastStrikeAt?: any;
    _type?: string;
}

/**
 * PILLAR MODEL: Transaction
 */
export interface Transaction {
    id?: string;
    userId: string;
    type: 'DEBIT' | 'CREDIT' | 'debit' | 'credit';
    amount: number;
    currency?: string;
    previousBalance?: number;
    newBalance?: number;
    requestId?: string;
    status: 'pending' | 'completed' | 'refunded' | 'failed';
    source?: string;
    metadata?: any;
    timestamp: any; // Firestore Timestamp
    createdAt?: string;
    refundedAt?: any;
    refundReason?: string;
    originalTxId?: string;
}

/**
 * PILLAR MODEL: Command
 */
export interface CommandContext {
    logger: Logger;
    jobs: Map<string, any>;
    signal: AbortSignal;
    engine?: any; // HiveEngine
}

export interface Command {
    data: SlashCommandBuilder | any;
    category?: 'image' | 'utility' | 'admin' | string;
    execute(interaction: HiveProxyInteraction, context: CommandContext): Promise<any>;
}

export interface ButtonInteractionHandler {
    customIdPrefix: string;
    execute(interaction: HiveProxyInteraction, context: CommandContext): Promise<any>;
}
