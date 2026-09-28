# Reproducible dev shell for working on Gamelog.
#
# This is not a flake for NixOS or for production: it only pins the versions of
# the development tools. It works on any system with Nix (Linux, macOS, WSL),
# NixOS or not, and it is entirely optional — the README also documents the
# classic route with Go and Node installed by hand.
#
#   nix develop
#
{
  description = "Gamelog development environment (Go + Node + Air)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            go # backend
            gopls # Go language server
            air # backend live reload
            nodejs_22 # frontend (Vite)
            mariadb.client # mysql/mariadb CLI for inspecting the database
            git-cliff # previews release notes from Conventional Commits
          ];

          shellHook = ''
            echo "Gamelog · go $(go version | cut -d' ' -f3 | sed 's/^go//') · node $(node --version)"
            echo "  backend:  cd backend && air"
            echo "  frontend: cd frontend && npm run dev"
            echo "  database: docker compose up -d"
          '';
        };
      });
}
