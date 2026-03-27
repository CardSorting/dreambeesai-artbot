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
