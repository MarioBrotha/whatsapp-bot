using System.Collections.Concurrent;
using System.Text.Json.Nodes;

namespace WhatsAppBot;

/// <summary>Decides what to send back for each incoming message.</summary>
public sealed class Bot(GraphClient graph, BotSettings settings, TimeProvider clock, ILogger<Bot> log)
{
    // Free text right after the menu is left for a human to read in the app.
    private static readonly TimeSpan MenuQuiet = TimeSpan.FromMinutes(30);

    // The bot stays quiet with a customer after a human replies from the WhatsApp
    // Business app, or after the customer asks for a person.
    private readonly ConcurrentDictionary<string, DateTimeOffset> _pausedUntil = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _lastMenuAt = new();

    private DateTimeOffset Now => clock.GetUtcNow();

    public async Task HandleWebhookAsync(JsonNode body)
    {
        foreach (var entry in body["entry"]?.AsArray() ?? [])
        foreach (var change in entry?["changes"]?.AsArray() ?? [])
        {
            var value = change?["value"];

            // A human replied from the WhatsApp Business app: step aside for that customer.
            if ((string?)change?["field"] == "smb_message_echoes")
                foreach (var echo in value?["message_echoes"]?.AsArray() ?? [])
                {
                    var to = (string?)echo?["to"];
                    if (to is null) continue;
                    log.LogInformation("Human replied to {Customer} - pausing bot for {Minutes} min", to, settings.HumanPause.TotalMinutes);
                    Pause(to);
                }

            foreach (var msg in value?["messages"]?.AsArray() ?? [])
                if (msg is not null)
                    await HandleMessageAsync(msg);
        }
    }

    private async Task HandleMessageAsync(JsonNode msg)
    {
        var from = (string?)msg["from"];
        if (from is null) return;

        var interactive = msg["interactive"];
        var choice = (string?)(interactive?["button_reply"] ?? interactive?["list_reply"])?["id"];
        var typed = ((string?)msg["text"]?["body"])?.Trim().ToLowerInvariant() ?? "";

        // Typing "menu" always brings the bot back.
        if (typed == "menu")
        {
            _pausedUntil.TryRemove(from, out _);
            await SendMenuAsync(from);
            return;
        }
        if (_pausedUntil.TryGetValue(from, out var until) && until > Now)
        {
            log.LogInformation("Paused for {Customer} - leaving it to a human", from);
            return;
        }

        switch (choice)
        {
            case "book":
                await graph.SendInteractiveAsync(from, Messages.Times);
                return;
            case { } slot when slot.StartsWith("slot_"):
                await graph.SendTextAsync(from, Messages.Booked(slot["slot_".Length..] + ":00"));
                return;
            case "info":
                await graph.SendTextAsync(from, Messages.Info);
                return;
            case "human":
                Pause(from);
                await graph.SendTextAsync(from, Messages.Human);
                return;
        }

        // Free text: show the menu, unless they just got it (then a human reads it in the app).
        if (_lastMenuAt.TryGetValue(from, out var last) && Now - last < MenuQuiet) return;
        await SendMenuAsync(from);
    }

    private Task SendMenuAsync(string to)
    {
        _lastMenuAt[to] = Now;
        return graph.SendInteractiveAsync(to, Messages.Menu);
    }

    private void Pause(string customer) => _pausedUntil[customer] = Now + settings.HumanPause;
}
