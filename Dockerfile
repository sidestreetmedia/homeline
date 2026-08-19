# HomeLine — LAMP-style image (Apache + PHP) with a baked-in cron worker.
# Pin the Debian suite so a floating PHP tag cannot silently change package
# availability underneath production installs.
FROM php:8.2-apache-bookworm

# System deps + PHP extensions.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        cron \
        unzip \
        libzip-dev \
        libxml2-dev \
        default-mysql-client \
    ; \
    docker-php-ext-install -j"$(nproc)" pdo_mysql mysqli zip simplexml; \
    rm -rf /var/lib/apt/lists/*

# Apache: enable rewrite + headers, point docroot at /public.
RUN a2enmod rewrite headers
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

# Composer.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Install PHP deps first (better layer caching).
COPY composer.json ./
RUN composer install --no-dev --no-interaction --no-progress --optimize-autoloader || true

# App source.
COPY . .
RUN composer install --no-dev --no-interaction --no-progress --optimize-autoloader

# Cron: run the worker every minute.
COPY docker/cron.d/homeline /etc/cron.d/homeline
RUN chmod 0644 /etc/cron.d/homeline && crontab /etc/cron.d/homeline

# Permissions.
RUN chown -R www-data:www-data /var/www/html

# Entrypoint launches cron + apache.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
