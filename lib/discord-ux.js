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
 * A wrapper for Discord interactions that redirects all replies to a specific thread.
 * This allows "Seamless Thread Creation" where a command started in a channel 
 * continues its life inside a dedicated thread without code changes to the command.
 */
export class ThreadedInteraction {
    constructor(interaction, thread) {
        this.interaction = interaction;
        this.thread = thread;
        this.deferred = false;
        this.replied = false;
        this.threadMessage = null;

        return new Proxy(this, {
            get: (target, prop) => {
                // If the property exists on our wrapper, use it
                if (prop in target) {
                    const value = target[prop];
                    if (typeof value === 'function') return value.bind(target);
                    return value;
                }
                // Otherwise, delegate to the original interaction
                const value = interaction[prop];
                if (typeof value === 'function') return value.bind(interaction);
                return value;
            }
        });
    }

    async deferReply(options = {}) {
        if (this.deferred || this.replied) return;
        this.deferred = true;
        
        const jobName = this.interaction.commandName || 'Art Generation';
        this.threadMessage = await this.thread.send({ 
            content: `🐝 **The Hive is buzzing...** (Working on \`/${jobName}\`)` 
        });
        return this.threadMessage;
    }

    async deferUpdate() {
        // If it's a component interaction, we normally acknowledge it.
        // In a thread, we might not need to do anything if we're just updating the message.
        // But for proxy parity, we track it.
        this.deferred = true;
        if (this.interaction.deferUpdate) return this.interaction.deferUpdate();
    }

    async reply(options) {
        if (this.replied) return this.followUp(options);
        this.replied = true;
        const payload = typeof options === 'string' ? { content: options } : options;
        this.threadMessage = await this.thread.send(payload);
        return this.threadMessage;
    }

    async editReply(options) {
        const payload = typeof options === 'string' ? { content: options } : options;
        if (this.threadMessage) {
            return this.threadMessage.edit(payload);
        } else {
            this.threadMessage = await this.thread.send(payload);
            return this.threadMessage;
        }
    }

    async followUp(options) {
        const payload = typeof options === 'string' ? { content: options } : options;
        return this.thread.send(payload);
    }

    async fetchReply() {
        return this.threadMessage;
    }

    async deleteReply() {
        if (this.threadMessage) {
            await this.threadMessage.delete().catch(() => {});
            this.threadMessage = null;
            this.replied = false;
            this.deferred = false;
        }
    }

    isRepliable() {
        return !this.replied && this.interaction.isRepliable();
    }

    // Ensure channel returns the thread for permission checks or sending
    get channel() {
        return this.thread;
    }

    // Utility to get the original interaction if needed
    get baseInteraction() {
        return this.interaction;
    }
}
