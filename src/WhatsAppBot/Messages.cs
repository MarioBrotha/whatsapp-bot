namespace WhatsAppBot;

/// <summary>What the bot says. Edit freely.</summary>
public static class Messages
{
    public static readonly object Menu = new
    {
        type = "button",
        body = new { text = "Hi! What would you like to do?" },
        action = new
        {
            buttons = new[]
            {
                Button("book", "Book a haircut"),
                Button("info", "Prices & hours"),
                Button("human", "Talk to a person"),
            },
        },
    };

    public static readonly object Times = new
    {
        type = "list",
        body = new { text = "Pick a time for your haircut:" },
        action = new
        {
            button = "Choose a time",
            sections = new[]
            {
                new
                {
                    title = "Tomorrow",
                    rows = new[]
                    {
                        new { id = "slot_10", title = "10:00" },
                        new { id = "slot_12", title = "12:00" },
                        new { id = "slot_16", title = "16:00" },
                    },
                },
            },
        },
    };

    public const string Info =
        "Haircut: S/ 30\nBeard trim: S/ 15\nHaircut + beard: S/ 40\n\nMon-Sat 9:00-20:00\nSunday closed";

    public const string Human = "Got it! A barber will reply here soon. 💈";

    public static string Booked(string time) => $"Booked for tomorrow at {time}. See you then! ✂️";

    // Button titles can be at most 20 characters; a message can have at most 3 buttons.
    private static object Button(string id, string title) => new { type = "reply", reply = new { id, title } };
}
