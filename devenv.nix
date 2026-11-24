{ inputs, pkgs, ... }:

{
  overlays = [ inputs.js-toolchain-overlay.overlays.default ];

  languages.javascript = {
    enable = true;
    package = pkgs.node-bin.fromProject ./.;
    pnpm.enable = true;
    lsp.package = pkgs.vtsls;
  };

  packages = [
    pkgs.actionlint
    pkgs.git
    pkgs.nixfmt
    pkgs.prettierd
    pkgs.vscode-langservers-extracted
  ];
}
