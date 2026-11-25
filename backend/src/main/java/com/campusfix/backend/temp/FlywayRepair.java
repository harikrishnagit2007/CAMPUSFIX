package com.campusfix.backend.temp;

import org.flywaydb.core.Flyway;

public class FlywayRepair {
    public static void main(String[] args) {
        String url = System.getenv("SPRING_DATASOURCE_URL");
        String user = System.getenv("SPRING_DATASOURCE_USERNAME");
        String password = System.getenv("SPRING_DATASOURCE_PASSWORD");

        Flyway flyway = Flyway.configure()
                .dataSource(url, user, password)
                .locations("classpath:db/migration")
                .load();

        flyway.repair();

        System.out.println("Flyway repair completed.");
    }
}