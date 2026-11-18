/// Assistant models a user can choose in Profile (D-027).
///
/// The app stores and sends only the [AgentModelOption.key]; the server maps
/// it to a model id through its allowlist (`AGENT_MODEL_CHOICES` in
/// `backend/functions/src/config.ts`), so keys here must match those.
class AgentModelOption {
  const AgentModelOption({required this.key, required this.label, required this.note});

  final String key;
  final String label;

  /// One line shown under the label in the picker.
  final String note;
}

const defaultAgentModelKey = 'flash';

const agentModelOptions = [
  AgentModelOption(key: 'flash', label: 'Gemini Flash', note: 'Best answers'),
  AgentModelOption(
    key: 'flash-lite',
    label: 'Gemini Flash-Lite',
    note: 'Cheaper, may miss harder questions',
  ),
];

/// The option for [key]; an unknown or missing key gives the default.
AgentModelOption agentModelOption(String? key) =>
    agentModelOptions.where((o) => o.key == key).firstOrNull ??
    agentModelOptions.firstWhere((o) => o.key == defaultAgentModelKey);
