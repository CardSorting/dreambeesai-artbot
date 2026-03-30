import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    InteractionReplyOptions,
    ThreadChannel,
    TextBasedChannel,
    ChatInputCommandInteraction,
    ButtonInteraction,
    ModalSubmitInteraction,
    MessagePayload,
    StringSelectMenuBuilder
} from 'discord.js';
/**
 * PILLAR UTILITY: Internalized Logger
 */
export class Logger {
    constructor(private ctx: any = {}) {}
    private log(level: string, message: string, data: any = {}) {
        const payload = { timestamp: new Date().toISOString(), level, message, ...this.ctx, ...data };
        if (process.env.NODE_ENV === 'production') process.stdout.write(JSON.stringify(payload) + '\n');
        else process.stdout.write(`[${level}] ${message} ${Object.keys(data).length ? JSON.stringify(data) : ''}\n`);
    }
    info(m: string, d?: any) { this.log('INFO', m, d); }
    warn(m: string, d?: any) { this.log('WARN', m, d); }
    error(m: string, d?: any) { this.log('ERROR', m, d); }
}

const logger = new Logger();

/**
 * Unified Voice of the Hive
 */
export const Voice = {
    get restriction() { return `🚫 **Harvest Restricted!** 🐝\n\nYour daily Zaps are kept safe inside the **DreamBees Hive**. To unlock your rewards, join our official server!\n\n✨ **Join here:** ${process.env.INVITE_LINK || 'https://discord.com/invite/curMHRAN8y'}`; },
    safety: `🛑 **Queen's Guard Alert!** Your prompt contains prohibited terms. Please keep it clean!`,
    emptyJar: (cost: number, balance: number) => `🍯 **Empty Jar!** This harvest requires **${cost} Zaps**, but you only have **${balance.toFixed(1)}**.`,
    shortNectar: `🐝 **Bzzzzt!** We need a real nectar source to start! (Prompt too short)`,
    failure: `❌ **Bot Error:** Something went wrong in the Hive. Please try again later.`,
    capacity: `🔥 **Hive Swarmed!** We're currently at maximum capacity. Please wait a moment!`
};

/**
 * MONOLITHIC PILLAR: HiveUX
 * Utilities for Discord UI/UX, Embeds, and Interaction life-cycle management.
 */
export class HiveUX {
    /**
     * Standard Generation Embed (Adaptive Theming)
     */
    static createGenerationEmbed(prompt: string, modelId: string, cost = 4, risk?: any) {
        const color = risk?.score > 5 ? '#f59e0b' : '#fbbf24'; // Dynamic amber for low-risk alerts
        return new EmbedBuilder()
            .setTitle('🍯 Fresh Honey Harvested!')
            .setColor(color as any)
            .addFields(
                { name: '🌸 Nectar Source', value: prompt.length > 1000 ? prompt.substring(0, 1000) + '...' : prompt },
                { name: '🐝 Hive Worker', value: `\`${modelId}\``, inline: true },
                { name: '🍯 Nectar Used', value: `${cost} Zaps`, inline: true }
            )
            .setImage('attachment://generation.png')
            .setFooter({ text: 'DreamBees Hive • Keep your wings fluttering!' });
    }

    /**
     * Processing / Harvesting Embed
     */
    static createProcessingEmbed(prompt: string, modelId: string) {
        return new EmbedBuilder()
            .setTitle('🐝 Your Vision is being Harvested...')
            .setDescription('The Collective Hive has received your nectar and our workers are already busy in the fields. Please wait a moment while we compile your visions...')
            .setColor('#fbbf24')
            .addFields(
                { name: '🌸 Nectar Source', value: prompt.length > 500 ? prompt.substring(0, 500) + '...' : prompt },
                { name: '🐝 Assigned Worker', value: `\`${modelId}\``, inline: true }
            )
            .setFooter({ text: 'DreamBees Hive • Harvesting in progress...' });
    }

    /**
     * Feedback Loop Row (The Sovereign Voice)
     */
    static createFeedbackRow(interactionId: string) {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`feedback_good_${interactionId}`)
                .setLabel('👍 Sweet')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`feedback_bad_${interactionId}`)
                .setLabel('👎 Sour')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    /**
     * Interaction Row for Upscaling
     */
    static createUpscaleRow(interactionId: string, count: number = 4) {
        const labels = Array.from({ length: count }, (_, i) => `U${i + 1}`);
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            labels.map((label, i) =>
                new ButtonBuilder()
                    .setCustomId(`upscale_${interactionId}_${i}`)
                    .setLabel(label)
                    .setStyle(ButtonStyle.Primary)
            )
        );
    }

    /**
     * Interaction Row for Moderation/Deletion
     */
    static createModRow(interactionId: string) {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`gen_delete_${interactionId}`)
                .setLabel('🗑️ Delete')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`gen_report_${interactionId}`)
                .setLabel('🚩 Report')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    /**
     * Standard Status Embed
     */
    static createStatusEmbed(user: any, avatarURL: string, options: { isAvailable: boolean, nextReset: number, isMember: boolean }) {
        const joinedAtDate = user.joinedAt?.toDate?.() || (user.joinedAt instanceof Date ? user.joinedAt : new Date());
        const joinedAtField = `<t:${Math.floor(joinedAtDate.getTime() / 1000)}:R>`;
        
        const embed = new EmbedBuilder()
            .setTitle('🐝 DreamBees Status')
            .setDescription('Welcome back to the hive! Here is your current standing in the swarm.')
            .setColor('#fbbf24')
            .setThumbnail(avatarURL)
            .addFields(
                { name: '🐝 Resident', value: `@${user.discordTag || 'Unknown'}`, inline: true },
                { name: '🍯 Honey Jar', value: `**${(user.zaps || 0).toFixed(1)}** Zaps`, inline: true },
                { name: '🌻 Streak', value: `**Day ${user.claimStreak || 0}**`, inline: true },
                { name: '🕒 First Flight', value: joinedAtField, inline: true }
            );

        if (!options.isMember) {
            embed.addFields({ name: '🎁 Daily Reward', value: `🔒 **Vaulted!** Join the official server to unlock your daily honey.` });
        } else if (options.isAvailable) {
            embed.addFields({ name: '🎁 Daily Reward', value: `🟢 Available! Use \`/claim\` to get your reward!` });
        } else {
            embed.addFields({ name: '🎁 Daily Reward', value: `🔴 Claimed. Resets <t:${Math.floor(options.nextReset / 1000)}:R>` });
        }

        embed.setFooter({ text: 'DreamBees Discord Swarm • Keep your wings fluttering!' });
        return embed;
    }

    /**
     * Claim Success Embed
     */
    static createClaimSuccessEmbed(result: { rewardAmount: number, bonusAmount: number, newStreak: number, newBalance: number }) {
        const embed = new EmbedBuilder()
            .setTitle(result.bonusAmount > 0 ? `🌻 Pollination Bonus!` : `🍯 Honey Harvest Success!`)
            .setColor('#fbbf24')
            .setDescription(result.bonusAmount > 0 
                ? `Incredible! Your **Day ${result.newStreak}** pollination streak earned you a **+${result.bonusAmount} Zap** bonus jar!`
                : `You've gathered your daily Zaps. Keep your streak alive to fill your jars with massive bonuses!`)
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/3062/3062331.png')
            .addFields(
                { name: '🍯 Fresh Honey', value: `**${result.rewardAmount}** Zaps`, inline: true },
                { name: '🌻 Streak', value: `**Day ${result.newStreak}**`, inline: true },
                { name: '🏦 Jar Balance', value: `**${result.newBalance.toFixed(1)}** Zaps`, inline: true },
                { name: '🕒 Next Harvest', value: `<t:${Math.floor(new Date().setUTCHours(24, 0, 0, 0) / 1000)}:R>`, inline: false }
            )
            .setFooter({ text: 'DreamBees Hive • Keep your wings fluttering!' })
            .setTimestamp();
        return embed;
    }

    /**
     * Remix Studio UI
     */
    static createRemixUI(imageUrl: string, prompt: string, interactionId: string) {
        const embed = new EmbedBuilder()
            .setTitle('🍯 Universal Remix Hive')
            .setDescription(`**Target Honey:** [Direct Link](${imageUrl})\n**Original Nectar:** ${prompt.substring(0, 200)}...\n\nSelect a floral vibe below or click "Manual Remix".`)
            .setImage(imageUrl)
            .setColor('#fbbf24')
            .setFooter({ text: 'DreamBees Hive • Universal Image Evolution' });

        const mainActionRow = new ActionRowBuilder().addComponents(
             new ButtonBuilder()
                .setCustomId(`remix_upscale_${interactionId}_0`)
                .setLabel('Manual Remix 💡')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`remix_vibegrid_${interactionId}_0`)
                .setLabel('Elite Vibe Grid 🎰')
                .setStyle(ButtonStyle.Success)
        );

        const vibeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`remix_vibe_${interactionId}_0_cyberpunk`).setLabel('Cyberpunk ⚡').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`remix_vibe_${interactionId}_0_studio`).setLabel('Studio 📸').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`remix_vibe_${interactionId}_0_anime`).setLabel('Anime 🌸').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`remix_vibe_${interactionId}_0_dark`).setLabel('Dark 🌑').setStyle(ButtonStyle.Secondary)
        );

        const toolsRow = new ActionRowBuilder().addComponents(
             new StringSelectMenuBuilder()
                .setCustomId(`remix_tools_${interactionId}_0`)
                .setPlaceholder('🛠️ Advanced Remix Tools...')
                .addOptions([
                    { label: 'Genius Ideas 🔮', description: 'AI directions', value: 'genius' },
                    { label: 'Subtle Edit (0.5) ⚡', description: 'Low creativity', value: 'strength_low' },
                    { label: 'Explore Neighborhood 🧭', description: '4 variations', value: 'explore_variations' },
                    { label: 'Summon Prism 💎', description: 'Mythic realms', value: 'summon_prism' }
                ])
        );

        return { embeds: [embed], components: [mainActionRow as any, vibeRow as any, toolsRow as any] };
    }

    /**
     * Upscale Studio UI
     */
    static createUpscaleUI(originalInteractionId: string, imageIndex: number, imageUrl: string, prompt: string) {
        const embed = new EmbedBuilder()
            .setTitle(`Upscale Complete (U${imageIndex + 1}) ✨`)
            .setColor('#fbbf24')
            .setDescription('✨ **Image retrieved successfully!** This generation is saved to your independent Discord history.')
            .setImage(imageUrl);

        const mainActionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`remix_upscale_${originalInteractionId}_${imageIndex}`)
                .setLabel('Manual Remix 💡')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`remix_vibegrid_${originalInteractionId}_${imageIndex}`)
                .setLabel('Elite Vibe Grid 🎰')
                .setStyle(ButtonStyle.Success)
        );

        const vibeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`remix_vibe_${originalInteractionId}_${imageIndex}_cyberpunk`).setLabel('Cyberpunk ⚡').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`remix_vibe_${originalInteractionId}_${imageIndex}_studio`).setLabel('Studio 📸').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`remix_vibe_${originalInteractionId}_${imageIndex}_anime`).setLabel('Anime 🌸').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`remix_vibe_${originalInteractionId}_${imageIndex}_dark`).setLabel('Dark 🌑').setStyle(ButtonStyle.Secondary)
        );

        const toolsRow = new ActionRowBuilder().addComponents(
             new StringSelectMenuBuilder()
                .setCustomId(`remix_tools_${originalInteractionId}_${imageIndex}`)
                .setPlaceholder('🛠️ Advanced Remix Tools...')
                .addOptions([
                    { label: 'Genius Ideas 🔮', description: 'AI directions', value: 'genius' },
                    { label: 'Subtle Edit (0.5) ⚡', description: 'Low creativity', value: 'strength_low' },
                    { label: 'Explore Neighborhood 🧭', description: '4 variations', value: 'explore_variations' },
                    { label: 'Summon Prism 💎', description: 'Mythic realms', value: 'summon_prism' }
                ])
        );

        return { embeds: [embed], components: [mainActionRow as any, vibeRow as any, toolsRow as any] };
    }
    /**
     * Standard Success Embed (Generic)
     */
    static createSuccessEmbed(title: string, description: string) {
        return new EmbedBuilder()
            .setTitle(`🍯 ${title}`)
            .setDescription(description)
            .setColor('#fbbf24')
            .setFooter({ text: 'DreamBees Hive • Success!' });
    }

    /**
     * Standard Failure Embed (Generic)
     */
    static createFailureEmbed(title: string, description: string) {
        return new EmbedBuilder()
            .setTitle(`❌ ${title}`)
            .setDescription(description)
            .setColor('#ef4444')
            .setFooter({ text: 'DreamBees Hive • Error' });
    }
}

/**
 * Unified Interaction Proxy (Sentient Pass 3)
 * Manages the lifecycle of a Discord interaction, including state evolution.
 */
export class HiveProxyInteraction {
    private tokenExpired = false;
    private isEphemeral = false;
    private hasReplied = false;
    private lastMessage: any = null;

    constructor(
        public interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction, 
        public thread: ThreadChannel | null = null
    ) {}

    public get user() { return this.interaction.user; }
    public get id() { return this.interaction.id; }
    public get guildId() { return this.interaction.guildId; }
    public get channel() { return this.interaction.channel; }

    async defer(options: { ephemeral?: boolean } = {}) {
        if (this.interaction.deferred || this.interaction.replied) return;
        if (options.ephemeral) this.isEphemeral = true;
        await (this.interaction as any).deferReply(options).catch((e: any) => {
            if (e.code === 10062) this.tokenExpired = true;
            logger.error("Deferral failed", e);
        });
    }

    /**
     * EVOLUTION: Transitions a message from one state to another.
     */
    async evolve(payload: string | InteractionReplyOptions | EmbedBuilder) {
        if (!this.hasReplied) return await this.reply(payload);
        
        const data = payload instanceof EmbedBuilder ? { embeds: [payload] } : payload;
        try {
            if (this.lastMessage && 'edit' in this.lastMessage) {
                return await this.lastMessage.edit(data);
            }
            return await (this.interaction as any).editReply(data);
        } catch (err) {
            logger.warn(`Evolution failed for ${this.id}, falling back to followUp`, err);
            return await this.followUp(payload);
        }
    }

    /**
     * SELF-DESTRUCT: Automatically cleans up a message after a delay.
     */
    async selfDestruct(ms = 15000) {
        if (this.isEphemeral) return; // Ephemeral messages can't be deleted via API usually or it's redundant
        setTimeout(async () => {
            try {
                if (this.lastMessage && 'delete' in this.lastMessage) await this.lastMessage.delete();
                else await (this.interaction as any).deleteReply();
            } catch {
                // Ignore deletion errors (already deleted or permissions)
            }
        }, ms);
    }

    async reply(options: string | MessagePayload | InteractionReplyOptions | EmbedBuilder) {
        let payload: any;
        if (options instanceof EmbedBuilder) {
            payload = { embeds: [options] };
        } else {
            payload = typeof options === 'string' ? { content: options } : options;
        }

        if (this.thread && 'send' in this.thread) {
            if (this.interaction.deferred && !this.hasReplied && !this.tokenExpired) {
                await this.interaction.editReply({ content: '✅ **Sent to your Art Studio!**' }).catch(() => {});
            }
            this.hasReplied = true;
            this.lastMessage = await (this.thread as any).send(payload);
            return this.lastMessage;
        }

        try {
            if (this.tokenExpired) throw { code: 10062 };
            
            const result = (this.interaction.deferred || this.interaction.replied)
                ? await (this.interaction as any).editReply(payload)
                : await (this.interaction as any).reply(payload).catch((e: any) => {
                    if (e.code === 40060 || e.code === 'InteractionAlreadyReplied') 
                        return (this.interaction as any).editReply(payload);
                    throw e;
                });
            
            this.hasReplied = true;
            this.lastMessage = result;
            return result;
        } catch (e: any) {
            if (e.code === 10062 || e.code === 50227) {
                this.tokenExpired = true;
                if (this.interaction.channel && 'send' in this.interaction.channel) {
                    this.hasReplied = true;
                    this.lastMessage = await (this.interaction.channel as any).send(payload).catch(() => {});
                    return this.lastMessage;
                }
            }
            throw e;
        }
    }

    async followUp(options: string | MessagePayload | InteractionReplyOptions | EmbedBuilder) {
        let payload: any;
        if (options instanceof EmbedBuilder) {
            payload = { embeds: [options] };
        } else {
            payload = typeof options === 'string' ? { content: options } : options;
        }
        return await (this.interaction as any).followUp(payload);
    }
}
