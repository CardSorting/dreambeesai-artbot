import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export function createGenerationEmbed(prompt, modelId, dreambeesUid) {
    return new EmbedBuilder()
        .setTitle('Generation Complete! ✨')
        .setColor('#7289da')
        .addFields(
            { name: '📝 Prompt', value: prompt.length > 1000 ? prompt.substring(0, 1000) + '...' : prompt },
            { name: '🤖 Model', value: `\`${modelId}\``, inline: true },
            { 
                name: '🔗 Sync Status', 
                value: dreambeesUid ? '✅ **Saved to Collection**' : '⚠️ **Not Linked** (Visit [DreamBees](https://dreambeesai.com) to sync)', 
                inline: true 
            }
        )
        .setThumbnail('https://dreambeesai.com/logo.png')
        .setImage('attachment://grid.webp')
        .setFooter({ text: 'DreamBees Alchemist • 4 Zaps spent', iconURL: 'https://dreambeesai.com/logo.png' });
}

export function createUpscaleRow(interactionId) {
    return new ActionRowBuilder().addComponents(
        ['U1', 'U2', 'U3', 'U4'].map((label, i) =>
            new ButtonBuilder().setCustomId(`upscale_${interactionId}_${i}`).setLabel(label).setStyle(ButtonStyle.Primary)
        )
    );
}

export function createNavRow(dreambeesUid) {
    const navRow = new ActionRowBuilder();
    if (dreambeesUid) {
        navRow.addComponents(
            new ButtonBuilder()
                .setLabel('View My Collection')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://dreambeesai.com/profile`)
        );
    } else {
        navRow.addComponents(
            new ButtonBuilder()
                .setLabel('Link DreamBees Account')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://dreambeesai.com`)
        );
    }
    return navRow;
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
        this.deferred = true;
        // In a thread, we "defer" by sending an initial loading message
        this.threadMessage = await this.thread.send({ 
            content: '🎨 **DreamBees is thinking...**' 
        });
        return this.threadMessage;
    }

    async reply(options) {
        this.replied = true;
        this.threadMessage = await this.thread.send(options);
        return this.threadMessage;
    }

    async editReply(options) {
        if (this.threadMessage) {
            return this.threadMessage.edit(options);
        } else {
            this.threadMessage = await this.thread.send(options);
            return this.threadMessage;
        }
    }

    async followUp(options) {
        return this.thread.send(options);
    }

    async fetchReply() {
        if (this.threadMessage) return this.threadMessage;
        return null;
    }

    async deleteReply() {
        if (this.threadMessage) {
            await this.threadMessage.delete().catch(() => {});
            this.threadMessage = null;
            this.replied = false;
            this.deferred = false;
        }
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
