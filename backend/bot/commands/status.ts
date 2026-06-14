/**
 * bot/commands/status.ts — /status
 *
 * Public. Shows a snapshot of server health: FAQ count,
 * community post count, support ticket counts by status,
 * notification-channel connectivity, last 24h search
 * volume. Calls existing public endpoints where possible.
 *
 * v1.69 — Phase 6+ per-guild → batchId routing. (config,
 * batchId) tuple accepted for shape parity with the other
 * command handlers; the public health endpoint is global
 * so the batchId is unused here.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { BotConfig } from '../discordBot.js';

export const statusCommandData = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show server health: FAQ count, community posts, support tickets, last-24h search volume')
  .toJSON();

export async function executeStatus(
  interaction: ChatInputCommandInteraction,
  _config: BotConfig,
  _batchId: string | null = null
): Promise<void> {
  await interaction.deferReply();

  // Hit the public /api/admin/stats endpoint (the same
  // one the Programs Hub Overview tab uses). It already
  // accepts ?batchId=... so the per-program view works
  // when the runtime ctx carries one; here we omit it
  // because /status is a public-scope health view.
  const base = (process.env.PUBLIC_URL ?? 'http://localhost:6767').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/admin/stats`);
  if (!res.ok) {
    await interaction.followUp({
      embeds: [new EmbedBuilder().setColor(0xff6b6b).setTitle('Status failed').setDescription(`HTTP ${res.status}`)],
    });
    return;
  }
  const data = await res.json() as { faqs?: number; posts?: number; support?: { open?: number; pending?: number; resolved?: number } };
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Server status')
    .addFields(
      { name: 'FAQs',        value: `${data.faqs ?? '?'}`, inline: true },
      { name: 'Community',  value: `${data.posts ?? '?'}`, inline: true },
      { name: 'Support (open / pending / resolved)',
        value: `${data.support?.open ?? '?'} / ${data.support?.pending ?? '?'} / ${data.support?.resolved ?? '?'}`,
        inline: true },
    )
    .setTimestamp(new Date());
  await interaction.followUp({ embeds: [embed] });
}
