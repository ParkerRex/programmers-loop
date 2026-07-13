# Research pass: CLI contract

Evidence: a pure function makes success and incomplete-input behavior testable
without subprocess timing. The smallest useful interface is `runCli(args)`.
Uncertainty: executable packaging is deliberately outside this example.
