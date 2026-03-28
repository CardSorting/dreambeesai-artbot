import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { logger } from './logger.js';

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
            },
            set: (target, prop, value) => {
                target[prop] = value;
                return true;
            }
        });
    }

    async deferReply(options = {}) {
        // If we have a thread attached, we send a "Buzzing" message there first
        if (this.thread && !this.interaction.replied && !this.interaction.deferred) {
            const jobName = this.interaction.commandName || 'Art Generation';
            await this.thread.send({ 
                content: `🐝 **The Hive is buzzing...** (Working on \`/${jobName}\`)` 
            }).catch(() => {});
        }

        if (this.interaction.deferred || this.interaction.replied) return;

        try {
            await this.interaction.deferReply(options);
        } catch (e) {
            if (e.code === 10062) this.tokenExpired = true;
            logger.error("Deferral failed", e);
        }
    }

    async reply(options) {
        if (this.interaction.deferred || this.interaction.replied) {
            return await this.editReply(options);
        }

        const payload = typeof options === 'string' ? { content: options } : options;

        try {
            return await this.interaction.reply(payload);
        } catch (e) {
            if (e.code === 10062 || e.code === 40060) {
                this.tokenExpired = true;
                return await this.editReply(options);
            }
            throw e;
        }
    }

    async editReply(options) {
        const payload = typeof options === 'string' ? { content: options } : options;

        // --- THREAD REDIRECTION ---
        if (this.thread) {
            // Acknowledge the original interaction if it's still "Thinking"
            if (this.interaction.deferred && !this.interaction.replied && !this.tokenExpired) {
                await this.interaction.editReply({ content: '✅ **Sent to your Art Studio!**' }).catch(() => {});
            }
            return await this.thread.send(payload);
        }

        // --- REGULAR INTERACTION ---
        try {
            if (this.tokenExpired) throw { code: 10062 };
            return await this.interaction.editReply(payload);
        } catch (e) {
            if (e.code === 10062 || e.code === 50027) {
                this.tokenExpired = true;
                // Final Resilience: Fallback to channel message if token is dead
                if (this.interaction.channel) {
                    return await this.interaction.channel.send({
                        content: `⚠️ **Update:** The original interaction expired, but your result is ready!\n\n${payload.content || ''}`,
                        ...payload,
                        content: undefined
                    });
                }
            }
            throw e;
        }
    }

    async followUp(options) {
        const payload = typeof options === 'string' ? { content: options } : options;
        if (this.thread) return await this.thread.send(payload);
        return await this.interaction.followUp(payload);
    }

    async showModal(modal) {
        if (this.interaction.replied || this.interaction.deferred) {
            throw new Error("Cannot show modal after a reply or deferral has been issued.");
        }
        return await this.interaction.showModal(modal);
    }
}
