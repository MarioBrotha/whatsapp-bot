using System.Text.Json;

namespace WhatsAppBot;

/// <summary>Settings read from environment variables (see .env.example).</summary>
public sealed class BotSettings
{
    public required string VerifyToken { get; init; }
    public string AppSecret { get; init; } = "";
    public string AppId { get; init; } = "";
    public string EmbeddedSignupConfigId { get; init; } = "";
    public bool SignupEnabled { get; init; }
    public TimeSpan HumanPause { get; init; } = TimeSpan.FromMinutes(120);
    public string DataDir { get; init; } = "/data";

    public static BotSettings FromConfiguration(IConfiguration config) => new()
    {
        VerifyToken = config["VERIFY_TOKEN"] ?? throw new InvalidOperationException("VERIFY_TOKEN is not set"),
        AppSecret = config["APP_SECRET"] ?? "",
        AppId = config["APP_ID"] ?? "",
        EmbeddedSignupConfigId = config["ES_CONFIG_ID"] ?? "",
        SignupEnabled = config["SIGNUP_ENABLED"] == "1",
        HumanPause = TimeSpan.FromMinutes(double.TryParse(config["HUMAN_PAUSE_MINUTES"], out var m) ? m : 120),
        DataDir = config["DATA_DIR"] ?? "/data",
    };
}

/// <summary>
/// The number the bot sends from and its token. The signup page saves them to
/// connected.json, which wins over the PHONE_NUMBER_ID / WA_TOKEN env vars.
/// </summary>
public sealed class WhatsAppAccount
{
    private readonly string _file;
    private readonly ILogger<WhatsAppAccount> _log;

    public string Token { get; private set; }
    public string PhoneNumberId { get; private set; }

    public WhatsAppAccount(IConfiguration config, BotSettings settings, ILogger<WhatsAppAccount> log)
    {
        _log = log;
        _file = Path.Combine(settings.DataDir, "connected.json");
        Token = config["WA_TOKEN"] ?? "";
        PhoneNumberId = config["PHONE_NUMBER_ID"] ?? "";

        if (File.Exists(_file))
        {
            var saved = JsonSerializer.Deserialize<Connected>(File.ReadAllText(_file))!;
            Token = saved.token;
            PhoneNumberId = saved.phone_number_id;
            _log.LogInformation("Using connected number {Id} from connected.json", PhoneNumberId);
        }
    }

    public void Connect(string token, string wabaId, string phoneNumberId)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_file)!);
        File.WriteAllText(_file, JsonSerializer.Serialize(new Connected(token, wabaId, phoneNumberId),
            new JsonSerializerOptions { WriteIndented = true }));
        Token = token;
        PhoneNumberId = phoneNumberId;
    }

    private sealed record Connected(string token, string waba_id, string phone_number_id);
}
