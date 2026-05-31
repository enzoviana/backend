#!/bin/bash

# Script de démarrage rapide pour le backend Dimotec
# Usage: ./start.sh [production|development|stop|restart|logs]

set -e

# Couleurs pour les messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Fonction d'affichage
print_message() {
    echo -e "${GREEN}[Dimotec]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[Attention]${NC} $1"
}

print_error() {
    echo -e "${RED}[Erreur]${NC} $1"
}

# Vérifier que Docker est installé
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker n'est pas installé. Installez-le depuis https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose n'est pas installé."
        exit 1
    fi

    print_message "Docker et Docker Compose sont installés ✓"
}

# Vérifier le fichier .env
check_env() {
    if [ ! -f .env ]; then
        print_warning "Fichier .env non trouvé. Création depuis .env.example..."
        if [ -f .env.example ]; then
            cp .env.example .env
            print_warning "Fichier .env créé. Veuillez le configurer avant de continuer."
            print_warning "Éditez le fichier .env avec: nano .env"
            exit 1
        else
            print_error "Fichier .env.example non trouvé!"
            exit 1
        fi
    fi
    print_message "Fichier .env trouvé ✓"
}

# Démarrer en mode production
start_production() {
    print_message "Démarrage en mode PRODUCTION..."
    check_docker
    check_env

    print_warning "Assurez-vous que le fichier .env contient les valeurs de PRODUCTION!"
    echo "Voulez-vous continuer? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        print_message "Annulé."
        exit 0
    fi

    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d

    print_message "Application démarrée! ✓"
    print_message "Backend: http://localhost:3000"
    print_message "Utilisez './start.sh logs' pour voir les logs"
}

# Démarrer en mode développement
start_development() {
    print_message "Démarrage en mode DÉVELOPPEMENT..."
    check_docker
    check_env

    docker-compose up
}

# Arrêter les conteneurs
stop_containers() {
    print_message "Arrêt des conteneurs..."
    docker-compose down
    print_message "Conteneurs arrêtés ✓"
}

# Redémarrer les conteneurs
restart_containers() {
    print_message "Redémarrage des conteneurs..."
    docker-compose restart
    print_message "Conteneurs redémarrés ✓"
}

# Afficher les logs
show_logs() {
    print_message "Affichage des logs (Ctrl+C pour quitter)..."
    docker-compose logs -f
}

# Afficher le statut
show_status() {
    print_message "Statut des conteneurs:"
    docker-compose ps
}

# Nettoyer tout (⚠️ supprime les données)
clean_all() {
    print_warning "Cette action va supprimer tous les conteneurs et volumes (données MongoDB incluses)!"
    echo "Êtes-vous sûr? Tapez 'DELETE' pour confirmer:"
    read -r response
    if [ "$response" = "DELETE" ]; then
        print_message "Nettoyage complet..."
        docker-compose down -v
        docker system prune -f
        print_message "Nettoyage terminé ✓"
    else
        print_message "Annulé."
    fi
}

# Menu principal
show_help() {
    echo ""
    echo "Usage: ./start.sh [COMMANDE]"
    echo ""
    echo "Commandes disponibles:"
    echo "  production    Démarrer en mode production (détaché)"
    echo "  dev          Démarrer en mode développement (logs visibles)"
    echo "  stop         Arrêter les conteneurs"
    echo "  restart      Redémarrer les conteneurs"
    echo "  logs         Afficher les logs"
    echo "  status       Afficher le statut des conteneurs"
    echo "  clean        Nettoyer complètement (⚠️ supprime les données)"
    echo "  help         Afficher cette aide"
    echo ""
}

# Point d'entrée du script
case "$1" in
    production)
        start_production
        ;;
    dev|development)
        start_development
        ;;
    stop)
        stop_containers
        ;;
    restart)
        restart_containers
        ;;
    logs)
        show_logs
        ;;
    status)
        show_status
        ;;
    clean)
        clean_all
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        print_error "Commande inconnue: $1"
        show_help
        exit 1
        ;;
esac
