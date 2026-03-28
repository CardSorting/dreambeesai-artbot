import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export function createGenerationEmbed(prompt, modelId, cost = 4) {
    return new EmbedBuilder()
        .setTitle('🍯 Fresh Honey Harvested!')
        .setColor('#fbbf24') // Golden Bee
        .addFields(
            { name: '🌸 Nectar Source', value: prompt.length > 1000 ? prompt.substring(0, 1000) + '...' : prompt },
            { name: '🐝 Hive Worker', value: `\`${modelId}\``, inline: true },
            { name: '🍯 Nectar Used', value: `${cost} Zaps`, inline: true }
        )
        .setImage('attachment://generation.png')
        .setFooter({ text: 'DreamBees Hive • Keep your wings fluttering!' });
}

export function createUpscaleRow(interactionId) {
    return new ActionRowBuilder().addComponents(
        ['U1', 'U2', 'U3', 'U4'].map((label, i) =>
            new ButtonBuilder().setCustomId(`upscale_${interactionId}_${i}`).setLabel(label).setStyle(ButtonStyle.Primary)
        )
    );
}

/**
 * [DEPRECATED] Navigation row for web-app syncing is no longer used.
 */
export function createNavRow() {
    return null;
}

export function createModRow(interactionId) {
    return new ActionRowBuilder().addComponents(
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
 * HiveInteraction: A uniform proxy for Discord interactions.
 * Handles lifecycle safety, threaded redirection, and interaction expiry.
 */
export class HiveInteraction {
    constructor(interaction, thread = null) {
        this.interaction = interaction;
        this.thread = thread;
        this.deferred = false;
        this.replied = false;
        this.lastMessage = null;
        this.tokenExpired = false;

        return new Proxy(this, {
            get: (target, prop) => {
                if (prop in target) {
                    const value = target[prop];
                    if (typeof value === 'function') return value.bind(target);
                    return value;
                }
                const value = interaction[prop];
                if (typeof value === 'function') return value.bind(interaction);
                return value;
            }
        });
    }

    async deferReply(options = {}) {
        if (this.deferred || this.replied) return;
        this.deferred = true;

        if (this.thread) {
            const jobName = this.interaction.commandName || 'Art Generation';
            this.lastMessage = await this.thread.send({ 
                content: `🐝 **The Hive is buzzing...** (Working on \`/${jobName}\`)` 
            });
            return this.lastMessage;
        }

        try {
            await this.interaction.deferReply(options);
        } catch (e) {
            if (e.code === 10062) this.tokenExpired = true; // Unknown Interaction
            throw e;
        }
    }

    async reply(options) {
        if (this.replied) return this.followUp(options);
        this.replied = true;
        const payload = typeof options === 'string' ? { content: options } : options;

        if (this.thread) {
            this.lastMessage = await this.thread.send(payload);
            return this.lastMessage;
        }

        try {
            return await this.interaction.reply(payload);
        } catch (e) {
            if (e.code === 10062) {
                this.tokenExpired = true;
                return this.interaction.channel.send(payload); // Fallback to channel message
            }
            throw e;
        }
    }

    async editReply(options) {
        const payload = typeof options === 'string' ? { content: options } : options;
        
        // 1. Threaded Mode: Always use REST message editing (safe from interaction expiry)
        if (this.thread) {
            if (this.lastMessage) return this.lastMessage.edit(payload);
            this.lastMessage = await this.thread.send(payload);
            return this.lastMessage;
        }

        // 2. Regular Mode: Try interaction edit, fallback to channel message if expired
        try {
            if (this.tokenExpired) throw { code: 10062 };
            return await this.interaction.editReply(payload);
        } catch (e) {
            if (e.code === 10062) {
                this.tokenExpired = true;
                // If we have a channel, send a fresh message as fallback
                return this.interaction.channel.send({
                    content: `⚠️ **Update:** The original interaction expired, but your result is ready!\n\n${payload.content || ''}`,
                    ...payload,
                    content: undefined // Remove duplicate content if using ...payload
                });
            }
            throw e;
        }
    }

    async followUp(options) {
        const payload = typeof options === 'string' ? { content: options } : options;
        if (this.thread) return this.thread.send(payload);
        return this.interaction.followUp(payload);
    }

    async showModal(modal) {
        if (this.replied || this.deferred) {
            throw new Error("Cannot show modal after a reply or deferral has been issued.");
        }
        this.replied = true;
        return this.interaction.showModal(modal);
    }
}
